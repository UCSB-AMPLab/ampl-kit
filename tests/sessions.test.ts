/**
 * Session lifecycle tests
 *
 * These tests cover `app/sessions.server.ts` — the heart of how a signed-in
 * session is created, recognised, refreshed, and torn down. They pin down that
 * creating a session stores a row keyed by the SHA-256 hash of the raw cookie
 * token (never the token itself) with a thirty-day expiry; that reading a
 * request returns the user and session on a valid cookie but null when the
 * cookie is missing, malformed, or expired; and that the cookie name is chosen
 * by protocol — the locked-down `__Host-ampl_session` over HTTPS, the
 * prefix-less `ampl_session` over plain HTTP in dev — with each name rejected on
 * the wrong protocol. They cover the rolling idle-refresh that only touches
 * `last_seen_at` and `expires_at` once a day, destroying a session, and the
 * exact cookie attributes emitted on set and clear. The `Path=/` attribute is
 * checked explicitly because a wrong path would break single sign-on across the
 * tools on the `ampl.tools` apex. They run against an in-memory miniflare D1.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import {
  createSessionForUser,
  getSessionFromRequest,
  rollSessionIfIdle,
  destroySession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getCookieName,
} from "~/sessions.server";
import * as schema from "~/db/schema";
import { getDb, seedUser } from "./helpers/db";

function hashHex(raw: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(raw)));
}

describe("createSessionForUser", () => {
  it("inserts a sessions row whose id equals SHA-256(rawCookieValue) and returns expected fields", async () => {
    const db = getDb();
    const userId = await seedUser("alice@example.com", "alice");
    const before = Date.now();
    const result = await createSessionForUser(db, userId);
    const after = Date.now();

    // rawCookieValue is 64 hex chars (32 bytes hex-encoded)
    expect(result.rawCookieValue).toMatch(/^[0-9a-f]{64}$/);

    // session id IS the sha256 hash of the raw cookie value
    expect(result.sessionId).toBe(hashHex(result.rawCookieValue));

    // expiresAt ~ now + 30 days
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + thirtyDays);
    expect(result.expiresAt).toBeLessThanOrEqual(after + thirtyDays);

    // row was actually written with id = sessionId, user_id = userId
    const row = await db.select().from(schema.sessions).where(eq(schema.sessions.id, result.sessionId)).get();
    expect(row).toBeDefined();
    expect(row?.userId).toBe(userId);
    expect(row?.lastSeenAt).toBeNull();
  });
});

describe("getSessionFromRequest", () => {
  it("returns null when no cookie header is present", async () => {
    const db = getDb();
    const req = new Request("https://example.test/");
    const result = await getSessionFromRequest(db, req);
    expect(result).toBeNull();
  });

  it("returns null when cookie value is malformed (not 64 hex chars)", async () => {
    const db = getDb();
    const req = new Request("https://example.test/", {
      headers: { Cookie: "__Host-ampl_session=not-hex-value" },
    });
    const result = await getSessionFromRequest(db, req);
    expect(result).toBeNull();
  });

  it("returns null when session expired", async () => {
    const db = getDb();
    const userId = await seedUser("expired@example.com", "expired");
    const created = await createSessionForUser(db, userId);
    // Force expiry into the past
    await db
      .update(schema.sessions)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(schema.sessions.id, created.sessionId));
    const req = new Request("https://example.test/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    const result = await getSessionFromRequest(db, req);
    expect(result).toBeNull();
  });

  it("returns the session + user on a valid HTTPS cookie", async () => {
    const db = getDb();
    const userId = await seedUser("happy@example.com", "happy", { name: "Happy User", githubId: 99001 });
    const created = await createSessionForUser(db, userId);
    const req = new Request("https://example.test/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    const result = await getSessionFromRequest(db, req);
    expect(result).not.toBeNull();
    expect(result?.session.id).toBe(created.sessionId);
    expect(result?.user.id).toBe(userId);
    expect(result?.user.email).toBe("happy@example.com");
    expect(result?.user.handle).toBe("happy");
    expect(result?.user.name).toBe("Happy User");
    // GitHub-specific fields
    expect(result?.user.githubId).toBe(99001);
  });

  it("resolves the cookie name based on request protocol (HTTP -> ampl_session, HTTPS -> __Host-ampl_session)", async () => {
    const db = getDb();
    const userId = await seedUser("dev@example.com", "devuser");
    const created = await createSessionForUser(db, userId);

    // HTTP request must use the un-prefixed cookie name
    const httpReq = new Request("http://localhost:8787/", {
      headers: { Cookie: `ampl_session=${created.rawCookieValue}` },
    });
    const httpResult = await getSessionFromRequest(db, httpReq);
    expect(httpResult).not.toBeNull();
    expect(httpResult?.user.id).toBe(userId);

    // HTTP request with the __Host- prefix MUST NOT be accepted
    const httpReqWrongName = new Request("http://localhost:8787/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    const httpResultWrong = await getSessionFromRequest(db, httpReqWrongName);
    expect(httpResultWrong).toBeNull();

    // HTTPS request with the un-prefixed name MUST NOT be accepted
    const httpsReqWrongName = new Request("https://example.test/", {
      headers: { Cookie: `ampl_session=${created.rawCookieValue}` },
    });
    const httpsResultWrong = await getSessionFromRequest(db, httpsReqWrongName);
    expect(httpsResultWrong).toBeNull();
  });
});

describe("rollSessionIfIdle", () => {
  it("no-op when last_seen_at was set within the throttle window (< 24h ago)", async () => {
    const db = getDb();
    const userId = await seedUser("throttled@example.com", "throttled");
    const created = await createSessionForUser(db, userId);

    // Simulate the row having been touched 1 hour ago.
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const originalExpiresAt = oneHourAgo + 30 * 24 * 60 * 60 * 1000;
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: oneHourAgo, expiresAt: originalExpiresAt })
      .where(eq(schema.sessions.id, created.sessionId));

    const before = await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get();
    expect(before).toBeDefined();
    await rollSessionIfIdle(db, before!);

    const after = await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get();
    // Neither lastSeenAt nor expiresAt should have changed
    expect(after?.lastSeenAt).toBe(oneHourAgo);
    expect(after?.expiresAt).toBe(originalExpiresAt);
  });

  it("updates last_seen_at + expires_at when last_seen_at is null (first roll)", async () => {
    const db = getDb();
    const userId = await seedUser("firstroll@example.com", "firstroll");
    const created = await createSessionForUser(db, userId);

    const before = await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get();
    expect(before?.lastSeenAt).toBeNull();
    const t0 = Date.now();
    await rollSessionIfIdle(db, before!);
    const t1 = Date.now();

    const after = await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get();
    expect(after?.lastSeenAt).not.toBeNull();
    expect(after!.lastSeenAt!).toBeGreaterThanOrEqual(t0);
    expect(after!.lastSeenAt!).toBeLessThanOrEqual(t1);
    // expires_at also rolled forward: should be ~ now + 30d
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(after!.expiresAt).toBeGreaterThanOrEqual(t0 + thirtyDays);
    expect(after!.expiresAt).toBeLessThanOrEqual(t1 + thirtyDays);
  });

  it("updates when (now - last_seen_at) >= 24h (cross the throttle window)", async () => {
    const db = getDb();
    const userId = await seedUser("rolled@example.com", "rolled");
    const created = await createSessionForUser(db, userId);

    // Simulate last_seen_at 25h ago.
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: twentyFiveHoursAgo, expiresAt: twentyFiveHoursAgo + 30 * 24 * 60 * 60 * 1000 })
      .where(eq(schema.sessions.id, created.sessionId));

    const before = await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get();
    const t0 = Date.now();
    await rollSessionIfIdle(db, before!);
    const t1 = Date.now();

    const after = await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get();
    expect(after!.lastSeenAt!).toBeGreaterThanOrEqual(t0);
    expect(after!.lastSeenAt!).toBeLessThanOrEqual(t1);
    expect(after!.expiresAt).toBeGreaterThan(before!.expiresAt);
  });
});

describe("destroySession", () => {
  it("deletes the sessions row by id", async () => {
    const db = getDb();
    const userId = await seedUser("bye@example.com", "byeuser");
    const created = await createSessionForUser(db, userId);

    await destroySession(db, created.sessionId);

    const row = await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get();
    expect(row).toBeUndefined();
  });

  it("subsequent getSessionFromRequest returns null after destroySession", async () => {
    const db = getDb();
    const userId = await seedUser("destroytest@example.com", "destroytest");
    const created = await createSessionForUser(db, userId);

    await destroySession(db, created.sessionId);

    const req = new Request("https://example.test/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    const result = await getSessionFromRequest(db, req);
    expect(result).toBeNull();
  });
});

describe("sessionCookieHeader", () => {
  it("emits __Host-ampl_session with Secure on HTTPS", () => {
    const raw = "a".repeat(64);
    const header = sessionCookieHeader(raw, true);
    expect(header).toContain(`__Host-ampl_session=${raw}`);
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=2592000");
  });

  it("HTTPS cookie contains Path=/ and NOT Path=/auth (SSO guard)", () => {
    const raw = "a".repeat(64);
    const header = sessionCookieHeader(raw, true);
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Path=/auth");
    expect(header).not.toContain("Path=/palaeography");
  });

  it("emits ampl_session WITHOUT Secure on HTTP (dev-strip)", () => {
    const raw = "b".repeat(64);
    const header = sessionCookieHeader(raw, false);
    expect(header).toContain(`ampl_session=${raw}`);
    expect(header).not.toContain("__Host-ampl_session");
    expect(header).not.toMatch(/(^|;\s*)Secure(;|$)/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=2592000");
  });

  it("HTTP (dev-strip) cookie does NOT contain Secure attribute", () => {
    const raw = "c".repeat(64);
    const header = sessionCookieHeader(raw, false);
    expect(header).not.toContain("Secure");
  });
});

describe("clearSessionCookieHeader", () => {
  it("emits Max-Age=0 with __Host-ampl_session on HTTPS and Path=/", () => {
    const header = clearSessionCookieHeader(true);
    expect(header).toContain("__Host-ampl_session=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Path=/auth");
  });

  it("emits Max-Age=0 with ampl_session on HTTP and Path=/", () => {
    const header = clearSessionCookieHeader(false);
    expect(header).toContain("ampl_session=");
    expect(header).not.toContain("__Host-");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Path=/");
  });
});

describe("getCookieName", () => {
  it("returns __Host-ampl_session when the origin is secure", () => {
    expect(getCookieName(true)).toBe("__Host-ampl_session");
  });
  it("returns ampl_session when the origin is HTTP", () => {
    expect(getCookieName(false)).toBe("ampl_session");
  });
});
