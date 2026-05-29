/**
 * Auth kit consumer integration tests
 *
 * These tests look at the kit the way a downstream tool would — importing only
 * the public `@ampl/kit/auth` entry point — and prove the contract it promises.
 * They show that a consumer can hand a real `__Host-ampl_session` cookie to
 * `validateSession` and get back an authenticated user, and that the same call
 * returns null for a missing, malformed, or expired cookie. They confirm the
 * dev-mode parity where the prefix-less `ampl_session` cookie still resolves
 * over plain HTTP on localhost, and that validation never writes — it is a
 * read-only projection. The consumer's database handle is deliberately typed to
 * only the `users` and `sessions` tables, so a read-only consumer cannot even
 * reach the write helpers. Those write helpers are used here for seeding only,
 * standing in for what the auth flow would normally create.
 *
 * @version v0.1.0
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";

// The consumer entry point — all validation comes from @ampl/kit/auth
import {
  validateSession,
  safeReturnTo,
  buildLoginRedirect,
  buildLogoutHref,
  users,
  sessions,
  type AuthDbSchema,
} from "@ampl/kit/auth";

// Seeding-only imports: internal ampl-auth helpers (not the kit)
import { seedUser } from "../helpers/db";
import { createSessionForUser } from "~/sessions.server";
import * as schema from "~/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Consumer perspective: typed to read-only subset — only users + sessions
// visible in scope. No pings, no write helpers. This proves a read-only consumer
// cannot reach write helpers.
// ─────────────────────────────────────────────────────────────────────────────
const authDb = drizzle(env.AUTH_DB, { schema: { users, sessions } satisfies AuthDbSchema });

// ─────────────────────────────────────────────────────────────────────────────
// validateSession — four states + dev parity
// ─────────────────────────────────────────────────────────────────────────────
describe("validateSession — four states", () => {
  it("valid: returns AuthenticatedUser for a live __Host-ampl_session", async () => {
    // Seed user and session using the write-capable db (ampl-auth internals)
    const db = drizzle(env.AUTH_DB, { schema });
    const userId = await seedUser("alice@example.com", "alice");
    const created = await createSessionForUser(db, userId);

    // Consumer call: HTTPS request with __Host- prefix
    const req = new Request("https://ampl.tools/palaeography/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    const user = await validateSession(authDb, req);

    expect(user).not.toBeNull();
    expect(user?.id).toBe(userId);
    expect(user?.email).toBe("alice@example.com");
    expect(user?.handle).toBe("alice");
  });

  it("missing cookie: returns null", async () => {
    const req = new Request("https://ampl.tools/palaeography/");
    expect(await validateSession(authDb, req)).toBeNull();
  });

  it("malformed cookie (not 64 hex chars): returns null", async () => {
    const req = new Request("https://ampl.tools/palaeography/", {
      headers: { Cookie: "__Host-ampl_session=not-64-hex" },
    });
    expect(await validateSession(authDb, req)).toBeNull();
  });

  it("expired session: returns null", async () => {
    const db = drizzle(env.AUTH_DB, { schema });
    const userId = await seedUser("expired@example.com", "expired");
    const created = await createSessionForUser(db, userId);

    // Force expiresAt into the past (mirrors sessions.test.ts lines 84-88)
    await db
      .update(schema.sessions)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(schema.sessions.id, created.sessionId));

    const req = new Request("https://ampl.tools/palaeography/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    expect(await validateSession(authDb, req)).toBeNull();
  });

  it("dev parity: ampl_session (HTTP, no __Host-) resolves on HTTP request", async () => {
    // HTTP localhost uses prefix-less cookie name (dev-strip)
    const db = drizzle(env.AUTH_DB, { schema });
    const userId = await seedUser("dev@example.com", "devuser");
    const created = await createSessionForUser(db, userId);

    const req = new Request("http://localhost:8787/palaeography/", {
      headers: { Cookie: `ampl_session=${created.rawCookieValue}` },
    });
    const user = await validateSession(authDb, req);

    expect(user).not.toBeNull();
    expect(user?.id).toBe(userId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateSession — zero writes
// Asserts that validateSession never calls insert, update, or delete on any
// code path — enforcing the read-only contract that lets consumers bind
// AUTH_DB read-only with confidence.
// ─────────────────────────────────────────────────────────────────────────────
describe("validateSession — zero writes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never calls insert, update, or delete on the happy path (live session)", async () => {
    const db = drizzle(env.AUTH_DB, { schema });
    const userId = await seedUser("nowrite@example.com", "nowrite");
    const created = await createSessionForUser(db, userId);

    // Spy on the Drizzle write methods after seeding
    const insertSpy = vi.spyOn(authDb, "insert");
    const updateSpy = vi.spyOn(authDb, "update");
    const deleteSpy = vi.spyOn(authDb, "delete");

    const req = new Request("https://ampl.tools/palaeography/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    await validateSession(authDb, req);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("never calls insert, update, or delete when cookie is missing", async () => {
    const insertSpy = vi.spyOn(authDb, "insert");
    const updateSpy = vi.spyOn(authDb, "update");
    const deleteSpy = vi.spyOn(authDb, "delete");

    const req = new Request("https://ampl.tools/palaeography/");
    await validateSession(authDb, req);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("never calls insert, update, or delete when cookie is malformed", async () => {
    const insertSpy = vi.spyOn(authDb, "insert");
    const updateSpy = vi.spyOn(authDb, "update");
    const deleteSpy = vi.spyOn(authDb, "delete");

    const req = new Request("https://ampl.tools/palaeography/", {
      headers: { Cookie: "__Host-ampl_session=not-64-hex" },
    });
    await validateSession(authDb, req);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// safeReturnTo + buildLoginRedirect (open-redirect guard)
// ─────────────────────────────────────────────────────────────────────────────
describe("safeReturnTo + buildLoginRedirect", () => {
  it("safeReturnTo rejects protocol-relative URLs", () => {
    expect(safeReturnTo("//evil.com")).toBe("/");
  });

  it("safeReturnTo preserves apex path and search", () => {
    expect(safeReturnTo("/palaeography/x?p=2")).toBe("/palaeography/x?p=2");
  });

  it("safeReturnTo rejects null", () => {
    expect(safeReturnTo(null)).toBe("/");
  });

  it("safeReturnTo rejects non-slash-prefixed value", () => {
    expect(safeReturnTo("evil.com")).toBe("/");
  });

  it("safeReturnTo rejects backslash", () => {
    expect(safeReturnTo("/path\\evil")).toBe("/");
  });

  it("buildLoginRedirect builds an absolute URL with no double /auth/ prefix", () => {
    const url = buildLoginRedirect("/palaeography", "https://ampl.tools");
    expect(url).toBe("https://ampl.tools/auth/login?return_to=%2Fpalaeography");
    // Guard: must not produce /auth/auth double-prefix
    expect(url).not.toContain("/auth/auth");
  });

  it("buildLoginRedirect accepts a custom authBasename", () => {
    const url = buildLoginRedirect("/calamus", "https://ampl.tools", "/auth");
    expect(url).toBe("https://ampl.tools/auth/login?return_to=%2Fcalamus");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildLogoutHref — mirrors buildLoginRedirect
// ─────────────────────────────────────────────────────────────────────────────
describe("buildLogoutHref", () => {
  it("builds an absolute logout URL with no double /auth/ prefix", () => {
    const url = buildLogoutHref("/palaeography", "https://ampl.tools");
    expect(url).toBe("https://ampl.tools/auth/logout?return_to=%2Fpalaeography");
    // Guard: must not produce /auth/auth double-prefix
    expect(url).not.toContain("/auth/auth");
  });

  it("accepts a custom authBasename matching buildLoginRedirect behaviour", () => {
    const url = buildLogoutHref("/calamus", "https://ampl.tools", "/auth");
    expect(url).toBe("https://ampl.tools/auth/logout?return_to=%2Fcalamus");
  });

  it("percent-encodes the returnTo path", () => {
    const url = buildLogoutHref("/path with spaces", "https://ampl.tools");
    expect(url).toContain("return_to=%2Fpath%20with%20spaces");
  });
});
