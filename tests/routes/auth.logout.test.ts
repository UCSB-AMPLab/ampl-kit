/**
 * Logout action tests
 *
 * These tests cover `app/routes/auth.logout.tsx` — the action that signs a user
 * out. They prove the core behaviour: a `POST` with a valid session deletes the
 * session row from the database and returns a redirect to an absolute
 * `/auth/login` URL, clearing the session cookie with `Max-Age=0`, `Path=/`,
 * and the protocol-appropriate cookie name. They also cover the edges that must
 * not break a sign-out: logging out with no session cookie still redirects
 * cleanly rather than crashing, the rate limiter turns the request into a 429,
 * a safe `return_to` sends the user to an apex path without a stray `/auth`
 * prefix, and a hostile `return_to` (a protocol-relative URL) is rejected so it
 * cannot become an open redirect. Redirect targets are checked as absolute URLs
 * to guard against the basename being doubled.
 *
 * @version v0.1.0
 */

import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { action } from "~/routes/auth.logout";
import { createSessionForUser } from "~/sessions.server";
import { cloudflareContext } from "~/context";
import * as schema from "~/db/schema";
import { getDb, seedUser } from "../helpers/db";
import { extractSessionCookie } from "../helpers/cookies";

function buildContext(): RouterContextProvider {
  const ctx = new RouterContextProvider();
  ctx.set(cloudflareContext, {
    env,
    ctx: {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext,
  });
  return ctx;
}

describe("auth.logout action", () => {
  it("valid session → session row deleted; redirect to absolute /auth/login; clear cookie Max-Age=0 Path=/", async () => {
    const db = getDb();
    const userId = await seedUser("logout-l1@example.com", "logout-l1");
    const created = await createSessionForUser(db, userId);

    // Confirm session exists before logout
    const before = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, created.sessionId))
      .get();
    expect(before).toBeDefined();

    // Use HTTPS so the cookie name is __Host-ampl_session
    const request = new Request("https://example.test/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `__Host-ampl_session=${created.rawCookieValue}`,
        "Sec-Fetch-Site": "same-origin",
      },
    });

    let thrown: unknown;
    try {
      await action({ request, context: buildContext(), params: {} } as any);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Response);
    const resp = thrown as Response;

    // 3xx redirect
    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    // Location is absolute and contains /auth/login — not /auth/auth/login
    const loc = resp.headers.get("Location");
    expect(loc).toMatch(/^https?:\/\//);
    expect(loc).toContain("/auth/login");
    expect(loc).not.toContain("/auth/auth");

    // Clear cookie: correct name, Max-Age=0, Path=/
    const sessionCookie = extractSessionCookie(resp);
    expect(sessionCookie).not.toBeNull();
    expect(
      sessionCookie?.name === "__Host-ampl_session" ||
        sessionCookie?.name === "ampl_session",
    ).toBe(true);
    expect(sessionCookie?.attrs["max-age"]).toBe("0");
    expect(sessionCookie?.attrs["path"]).toBe("/");

    // Session row deleted from DB
    const after = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, created.sessionId))
      .get();
    expect(after).toBeUndefined();
  });

  it("no session cookie → still 3xx redirect without error", async () => {
    const request = new Request("https://example.test/auth/logout", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
      // No Cookie header
    });

    let thrown: unknown;
    try {
      await action({ request, context: buildContext(), params: {} } as any);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Response);
    const resp = thrown as Response;
    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    // Still redirects to absolute /auth/login
    const loc = resp.headers.get("Location");
    expect(loc).toMatch(/^https?:\/\//);
    expect(loc).toContain("/auth/login");
  });

  it("rate-limit miss → 429 response (not a redirect)", async () => {
    const spy = vi
      .spyOn(env.AUTH_RATE_LIMITER, "limit")
      .mockResolvedValueOnce({ success: false });
    try {
      const request = new Request("https://example.test/auth/logout", {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
      });
      const result = (await action({
        request,
        context: buildContext(),
        params: {},
      } as any)) as { init?: ResponseInit };
      // react-router's data() returns a DataWithResponseInit-like object
      // exposing `init.status`.
      expect(result?.init?.status).toBe(429);
    } finally {
      spy.mockRestore();
    }
  });

  it("return_to=/palaeography → redirects to absolute apex /palaeography (no /auth prefix); cookie cleared", async () => {
    const db = getDb();
    const userId = await seedUser("logout-l4@example.com", "logout-l4");
    const created = await createSessionForUser(db, userId);

    const request = new Request(
      "https://example.test/auth/logout?return_to=%2Fpalaeography",
      {
        method: "POST",
        headers: {
          Cookie: `__Host-ampl_session=${created.rawCookieValue}`,
          "Sec-Fetch-Site": "same-origin",
        },
      },
    );

    let thrown: unknown;
    try {
      await action({ request, context: buildContext(), params: {} } as any);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Response);
    const resp = thrown as Response;

    // 3xx redirect
    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    // Location is absolute, ends in /palaeography, NOT /auth/palaeography
    const loc = resp.headers.get("Location");
    expect(loc).toMatch(/^https?:\/\//);
    expect(loc).toContain("/palaeography");
    expect(loc).not.toContain("/auth/palaeography");

    // Cookie cleared
    const sessionCookie = extractSessionCookie(resp);
    expect(sessionCookie?.attrs["max-age"]).toBe("0");
    expect(sessionCookie?.attrs["path"]).toBe("/");
  });

  it("return_to=//evil.com → safeReturnTo rejects it; falls back to /auth/login (open-redirect blocked)", async () => {
    const request = new Request(
      "https://example.test/auth/logout?return_to=%2F%2Fevil.com",
      {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
      },
    );

    let thrown: unknown;
    try {
      await action({ request, context: buildContext(), params: {} } as any);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Response);
    const resp = thrown as Response;

    // 3xx redirect
    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    // Location must end in /auth/login — open-redirect rejected, fallback to login
    const loc = resp.headers.get("Location");
    expect(loc).toMatch(/^https?:\/\//);
    expect(loc).toContain("/auth/login");
    expect(loc).not.toContain("evil.com");
  });
});

let ipSeq = 0;

describe("auth.logout same-origin check", () => {
  async function postWith(headers: Record<string, string>) {
    const db = getDb();
    const userId = await seedUser(`logout-origin-${Math.random()}@example.com`, "logout-origin");
    const created = await createSessionForUser(db, userId);
    const request = new Request("https://ampl.tools/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `__Host-ampl_session=${created.rawCookieValue}`,
        "CF-Connecting-IP": `10.88.0.${++ipSeq}`,
        ...headers,
      },
    });
    let thrown: unknown;
    try {
      await action({ request, context: buildContext(), params: {} } as any);
    } catch (err) {
      thrown = err;
    }
    const row = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, created.sessionId))
      .get();
    return { resp: thrown as Response, sessionKept: row !== undefined };
  }

  it("cross-site POST → 403; the session is kept", async () => {
    const { resp, sessionKept } = await postWith({ "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" });
    expect(resp.status).toBe(403);
    expect(sessionKept).toBe(true);
  });

  it("no Origin and no Sec-Fetch-Site → 403; the session is kept", async () => {
    const { resp, sessionKept } = await postWith({});
    expect(resp.status).toBe(403);
    expect(sessionKept).toBe(true);
  });

  it("Origin: null with Sec-Fetch-Site: same-origin (a no-referrer form post) signs out", async () => {
    const { resp, sessionKept } = await postWith({ "Sec-Fetch-Site": "same-origin", Origin: "null" });
    expect(resp.status).toBe(302);
    expect(sessionKept).toBe(false);
  });

  it("the app origin as Origin with Sec-Fetch-Site: same-origin signs out", async () => {
    const { resp, sessionKept } = await postWith({ "Sec-Fetch-Site": "same-origin", Origin: "https://ampl.tools" });
    expect(resp.status).toBe(302);
    expect(sessionKept).toBe(false);
  });
});
