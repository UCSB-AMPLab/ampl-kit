/**
 * Email sign-in link tests
 *
 * These tests cover the three email sign-in routes: `POST /auth/email/request`
 * (asks for a link), `GET /auth/email/verify` (shows "Sign in as ..." without
 * using the link) and `POST /auth/email/verify` (uses the link and signs the
 * person in). They drive the route functions directly with a request context
 * whose `AUTH_EMAIL` binding is a fake that records each request, so the link
 * a person would receive can be read back out of it.
 *
 * What they pin down: a link works once and only once, including under two
 * concurrent POSTs; it stops working after 15 minutes and when a newer link
 * is requested; a token with one digit changed or the wrong length is
 * refused; GET never uses the link; cross-origin POSTs, addresses outside the
 * allowed domains and failed Turnstile checks are refused; known and unknown
 * allowed addresses get identical responses; at most three links per address
 * per hour, with case and whitespace variants counted as one address;
 * `return_to` abuse never leaves the app origin, and neither does a forged
 * Host; an address that belongs to a GitHub account gets a notice and never a
 * session; and a first sign-in stores the name and the `~<id>` handle.
 *
 * @version v0.4.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { action as requestAction } from "~/routes/auth.email.request";
import { completeEmailSignIn } from "~/lib/email-login.server";
import { loader as verifyLoader, action as verifyAction } from "~/routes/auth.email.verify";
import * as schema from "~/db/schema";
import { getDb, seedUser } from "../helpers/db";
import { extractSessionCookie } from "../helpers/cookies";
import {
  APP_ORIGIN,
  TURNSTILE_FAIL_SECRET,
  callRoute,
  emailRequest,
  flushAllHarnesses,
  makeHarness,
  setCookies,
  stubTurnstile,
  tokenFromMessage,
  verifyGet,
  verifyPost,
  type Harness,
} from "../helpers/email-login";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

let fetchSpy: ReturnType<typeof stubTurnstile>;

beforeEach(() => {
  fetchSpy = stubTurnstile();
});

// The pool pops each test's storage frame before afterEach runs, so a test
// must flush its own harness; this only drains anything left over.
afterEach(async () => {
  await flushAllHarnesses();
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

function hashHex(raw: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(raw)));
}

/** Requests a link for `email` and returns the raw token from the message. */
async function requestLink(
  h: Harness,
  email: string,
  fields: { return_to?: string } = {},
): Promise<string> {
  const before = h.sent.length;
  const res = await callRoute(requestAction, emailRequest({ email, ...fields }), h.context());
  expect(res.response?.headers.get("Location")).toBe("/email/sent");
  await h.flush();
  expect(h.sent.length).toBe(before + 1);
  return tokenFromMessage(h.sent[h.sent.length - 1]);
}

async function signIn(h: Harness, token: string, name?: string, opts = {}) {
  return callRoute(verifyAction, verifyPost({ token, name }, opts), h.context());
}

async function sessionCount(userId: number): Promise<number> {
  const rows = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .all();
  return rows.length;
}

async function userByEmail(email: string) {
  return getDb().select().from(schema.users).where(eq(schema.users.email, email)).get();
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path and first sign-in
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — first sign-in", () => {
  it("creates the user with the given name and handle ~<id>, and mints a session", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "ana@ucsb.edu");

    const res = await signIn(h, token, "  Ana   Pérez ");
    expect(res.response).not.toBeNull();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(extractSessionCookie(res.response!)).not.toBeNull();

    const user = await userByEmail("ana@ucsb.edu");
    expect(user).toBeDefined();
    expect(user!.githubId).toBeNull();
    expect(user!.handle).toBe(`~${user!.id}`);
    expect(user!.name).toBe("Ana Pérez");
    expect(await sessionCount(user!.id)).toBe(1);
  });

  it("asks for a name on first sign-in and does not use the link without one", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "noname@ucsb.edu");

    const get = await callRoute(verifyLoader, verifyGet(token), h.context());
    expect(get.data.state).toBe("confirm");
    expect(get.data.email).toBe("noname@ucsb.edu");
    expect(get.data.needsName).toBe(true);

    const missing = await signIn(h, token, "   ");
    expect(missing.response).toBeNull();
    expect(missing.data.error).toBe("name-required");
    expect(await userByEmail("noname@ucsb.edu")).toBeUndefined();

    // The link still works once a name is given.
    const ok = await signIn(h, token, "Nadie");
    expect(extractSessionCookie(ok.response!)).not.toBeNull();
  });

  it("a returning email-only user is not asked for a name and keeps the same id", async () => {
    const h = makeHarness();
    const first = await requestLink(h, "back@ucsb.edu");
    await signIn(h, first, "Back Again");
    const user = await userByEmail("back@ucsb.edu");

    const second = await requestLink(h, "back@ucsb.edu");
    const get = await callRoute(verifyLoader, verifyGet(second), h.context());
    expect(get.data.needsName).toBe(false);

    const res = await signIn(h, second);
    expect(extractSessionCookie(res.response!)).not.toBeNull();
    const again = await userByEmail("back@ucsb.edu");
    expect(again!.id).toBe(user!.id);
    expect(again!.name).toBe("Back Again");
    expect(await sessionCount(user!.id)).toBe(2);
  });

  it("the session cookie matches the one the GitHub callback sets", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "cookie@ucsb.edu");
    const res = await signIn(h, token, "Cookie");
    const cookie = extractSessionCookie(res.response!);
    expect(cookie!.name).toBe("__Host-ampl_session");
    expect(cookie!.value).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie!.attrs["path"]).toBe("/");
    expect(cookie!.attrs["httponly"]).toBe(true);
    expect(cookie!.attrs["secure"]).toBe(true);
    expect(cookie!.attrs["samesite"]).toBe("Lax");
  });

  it("stores only the hash of the token", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "hash@ucsb.edu");
    const rows = await env.AUTH_DB.prepare(
      "SELECT id FROM email_login_tokens WHERE email = ?",
    )
      .bind("hash@ucsb.edu")
      .all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual([hashHex(token)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single use, expiry, tampering, superseding
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — token lifecycle", () => {
  it("refuses a replay of a used token", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "replay@ucsb.edu");
    const first = await signIn(h, token, "Replay");
    expect(extractSessionCookie(first.response!)).not.toBeNull();

    const second = await signIn(h, token, "Replay");
    expect(second.response).toBeNull();
    expect(second.data.state).toBe("invalid");

    const get = await callRoute(verifyLoader, verifyGet(token), h.context());
    expect(get.data.state).toBe("invalid");

    const user = await userByEmail("replay@ucsb.edu");
    expect(await sessionCount(user!.id)).toBe(1);
  });

  it("refuses an expired token (controlled clock), and accepts one just inside the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-11-09T12:00:00Z").getTime();
    vi.setSystemTime(t0);
    const h = makeHarness();
    const stale = await requestLink(h, "late@ucsb.edu");

    vi.setSystemTime(t0 + FIFTEEN_MINUTES + 1);
    const get = await callRoute(verifyLoader, verifyGet(stale), h.context());
    expect(get.data.state).toBe("invalid");
    const post = await signIn(h, stale, "Late");
    expect(post.response).toBeNull();
    expect(post.data.state).toBe("invalid");
    expect(await userByEmail("late@ucsb.edu")).toBeUndefined();

    const t1 = t0 + 2 * FIFTEEN_MINUTES;
    vi.setSystemTime(t1);
    const fresh = await requestLink(h, "late@ucsb.edu");
    vi.setSystemTime(t1 + FIFTEEN_MINUTES - 1000);
    const ok = await signIn(h, fresh, "Late");
    expect(extractSessionCookie(ok.response!)).not.toBeNull();
  });

  it("refuses a token with one hex digit changed, and tokens of the wrong length", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "tamper@ucsb.edu");
    const last = token[token.length - 1];
    const flipped = token.slice(0, -1) + (last === "0" ? "1" : "0");
    const variants = [flipped, token.slice(0, -1), token + "0", token.toUpperCase(), ""];
    for (const bad of variants) {
      const get = await callRoute(verifyLoader, verifyGet(bad), h.context());
      expect(get.data.state).toBe("invalid");
      const post = await signIn(h, bad, "Tamper");
      expect(post.response).toBeNull();
      expect(post.data.state).toBe("invalid");
    }
    expect(await userByEmail("tamper@ucsb.edu")).toBeUndefined();

    // The genuine token is untouched by the failed attempts.
    const ok = await signIn(h, token, "Tamper");
    expect(extractSessionCookie(ok.response!)).not.toBeNull();
  });

  it("a newer request makes the older, unused link stop working", async () => {
    const h = makeHarness();
    const older = await requestLink(h, "twice@ucsb.edu");
    const newer = await requestLink(h, "twice@ucsb.edu");
    expect(newer).not.toBe(older);

    const oldTry = await signIn(h, older, "Twice");
    expect(oldTry.response).toBeNull();
    expect(oldTry.data.state).toBe("invalid");

    const newTry = await signIn(h, newer, "Twice");
    expect(extractSessionCookie(newTry.response!)).not.toBeNull();
  });

  it("two concurrent POSTs with the same token create exactly one session", async () => {
    const h = makeHarness();
    // A first sign-in creates the user, so the two POSTs race only on the token.
    const warm = await signIn(h, await requestLink(h, "race@ucsb.edu"), "Race");
    expect(warm.response).not.toBeNull();
    const fresh = await requestLink(h, "race@ucsb.edu");

    const [a, b] = await Promise.all([signIn(h, fresh), signIn(h, fresh)]);
    const withCookie = [a, b].filter((r) => r.response && extractSessionCookie(r.response));
    expect(withCookie.length).toBe(1);
    const user = await userByEmail("race@ucsb.edu");
    // One session from the warm-up, one from the race.
    expect(await sessionCount(user!.id)).toBe(2);
  });

  it("two concurrent first sign-ins with the same token create one user and one session", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "race-new@ucsb.edu");
    const results = await Promise.all([signIn(h, token, "Racer"), signIn(h, token, "Racer")]);
    const withCookie = results.filter((r) => r.response && extractSessionCookie(r.response));
    expect(withCookie.length).toBe(1);
    const rows = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "race-new@ucsb.edu"))
      .all();
    expect(rows.length).toBe(1);
    expect(await sessionCount(rows[0].id)).toBe(1);
  });

  it("GET shows the confirmation without using the token", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "look@ucsb.edu");
    for (let i = 0; i < 3; i++) {
      const get = await callRoute(verifyLoader, verifyGet(token), h.context());
      expect(get.data.state).toBe("confirm");
      expect(get.data.email).toBe("look@ucsb.edu");
    }
    const row = await env.AUTH_DB.prepare(
      "SELECT consumed_at FROM email_login_tokens WHERE id = ?",
    )
      .bind(hashHex(token))
      .first<{ consumed_at: number | null }>();
    expect(row!.consumed_at).toBeNull();
    const ok = await signIn(h, token, "Look");
    expect(extractSessionCookie(ok.response!)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-origin, feature flag, domain policy, Turnstile
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — request guards", () => {
  it("rejects cross-origin POSTs to request and verify", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "csrf@ucsb.edu");
    const before = h.waitUntilCalls;

    const cases = [
      { site: "cross-site" },
      { site: "same-site" },
      { site: null, origin: "https://evil.example" },
      { site: null, origin: "null" },
      { site: null, origin: null },
      { site: "same-origin", origin: "https://evil.example" },
    ];
    for (const opts of cases) {
      const req = await callRoute(
        requestAction,
        emailRequest({ email: "csrf@ucsb.edu" }, opts),
        h.context(),
      );
      expect(req.status).toBe(403);
      const ver = await signIn(h, token, "Csrf", opts);
      expect(ver.status).toBe(403);
      expect(ver.response && extractSessionCookie(ver.response)).toBeFalsy();
    }
    expect(h.waitUntilCalls).toBe(before);

    // The token survived every rejected POST.
    const ok = await signIn(h, token, "Csrf");
    expect(extractSessionCookie(ok.response!)).not.toBeNull();
  });

  it("accepts a same-origin POST whose Origin is null (Referrer-Policy: no-referrer)", async () => {
    const h = makeHarness();
    const res = await callRoute(
      requestAction,
      emailRequest({ email: "nullorigin@ucsb.edu" }, { site: "same-origin", origin: "null" }),
      h.context(),
    );
    expect(res.response?.headers.get("Location")).toBe("/email/sent");
    await h.flush();
  });

  it("answers 404 on every route while EMAIL_LOGIN_ENABLED is off", async () => {
    const on = makeHarness();
    const token = await requestLink(on, "flag@ucsb.edu");
    const off = makeHarness({ EMAIL_LOGIN_ENABLED: "false" });
    const req = await callRoute(requestAction, emailRequest({ email: "flag@ucsb.edu" }), off.context());
    expect(req.status).toBe(404);
    const get = await callRoute(verifyLoader, verifyGet(token), off.context());
    expect(get.status).toBe(404);
    const post = await signIn(off, token, "Flag");
    expect(post.status).toBe(404);
    expect(off.waitUntilCalls).toBe(0);
  });

  it("rejects an address outside the allowed domains with an explicit error", async () => {
    const h = makeHarness();
    for (const email of [
      "someone@gmail.com",
      "someone@cs.ucsb.edu",
      "someone@evilucsb.edu",
      "someone@ucsb.edu.evil.com",
      "someone@ucsb.edu@gmail.com",
    ]) {
      const res = await callRoute(
        requestAction,
        emailRequest({ email, return_to: "/paleography" }),
        h.context(),
      );
      const loc = res.response!.headers.get("Location")!;
      expect(loc).toContain("/login?");
      expect(loc).toMatch(/error=email-(domain|invalid)/);
      expect(loc).toContain("return_to=%2Fpaleography");
    }
    expect(h.waitUntilCalls).toBe(0);
    const rows = await env.AUTH_DB.prepare("SELECT COUNT(*) AS n FROM email_login_tokens").first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  it("honors a custom EMAIL_LOGIN_DOMAINS list", async () => {
    const h = makeHarness({ EMAIL_LOGIN_DOMAINS: " UCSB.edu , example.org " });
    const res = await callRoute(requestAction, emailRequest({ email: "x@example.org" }), h.context());
    expect(res.response!.headers.get("Location")).toBe("/email/sent");
    const res2 = await callRoute(requestAction, emailRequest({ email: "x@example.com" }), h.context());
    expect(res2.response!.headers.get("Location")).toContain("error=email-domain");
    await h.flush();
  });

  it("rejects a malformed address", async () => {
    const h = makeHarness();
    for (const email of ["", "not-an-email", "@ucsb.edu", "a b@ucsb.edu", "a@", `${"a".repeat(250)}@ucsb.edu`]) {
      const res = await callRoute(requestAction, emailRequest({ email }), h.context());
      expect(res.response!.headers.get("Location")).toContain("error=email-invalid");
    }
    expect(h.waitUntilCalls).toBe(0);
  });

  it("rejects a failed or missing Turnstile check", async () => {
    const h = makeHarness();
    const missing = await callRoute(
      requestAction,
      emailRequest({ email: "bot@ucsb.edu", turnstile: "" }),
      h.context(),
    );
    expect(missing.response!.headers.get("Location")).toContain("error=turnstile-failed");

    const failing = makeHarness({ TURNSTILE_SECRET_KEY: TURNSTILE_FAIL_SECRET });
    const failed = await callRoute(requestAction, emailRequest({ email: "bot@ucsb.edu" }), failing.context());
    expect(failed.response!.headers.get("Location")).toContain("error=turnstile-failed");
    expect(h.waitUntilCalls + failing.waitUntilCalls).toBe(0);
  });

  it("refuses to send links when the Turnstile secret is missing", async () => {
    const h = makeHarness({ TURNSTILE_SECRET_KEY: undefined });
    const res = await callRoute(requestAction, emailRequest({ email: "cfg@ucsb.edu" }), h.context());
    expect(res.response!.headers.get("Location")).toContain("error=email-unavailable");
    expect(h.waitUntilCalls).toBe(0);
  });

  it("applies the per-IP rate limit before anything else", async () => {
    const h = makeHarness();
    const spy = vi.spyOn(env.AUTH_RATE_LIMITER, "limit").mockResolvedValueOnce({ success: false });
    try {
      const res = await callRoute(requestAction, emailRequest({ email: "busy@ucsb.edu" }), h.context());
      expect(res.response!.headers.get("Location")).toContain("error=rate-limited");
      expect(h.waitUntilCalls).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enumeration, caps, normalization
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — enumeration and caps", () => {
  it("known and unknown allowed addresses get identical responses, sent in the background", async () => {
    await seedUser("known@ucsb.edu", "~known", { githubId: null, name: "Known" });
    await seedUser("gh-known@ucsb.edu", "ghknown", { githubId: 880001 });
    const h = makeHarness();
    const responses: Response[] = [];
    for (const email of ["known@ucsb.edu", "unknown@ucsb.edu", "gh-known@ucsb.edu"]) {
      const res = await callRoute(requestAction, emailRequest({ email, return_to: "/x" }), h.context());
      responses.push(res.response!);
    }
    const shape = (r: Response) => ({
      status: r.status,
      location: r.headers.get("Location"),
      cookies: setCookies(r),
      body: r.body === null,
    });
    expect(shape(responses[1])).toEqual(shape(responses[0]));
    expect(shape(responses[2])).toEqual(shape(responses[0]));
    expect(h.waitUntilCalls).toBe(3);
    await h.flush();
    expect(h.sent.length).toBe(3);
  });

  it("allows at most three tokens per address per hour; variants count as one address", async () => {
    const h = makeHarness();
    const limitSpy = vi.spyOn(env.AUTH_RATE_LIMITER, "limit");
    try {
      for (const email of [" Cap@UCSB.edu ", "cap@ucsb.edu", "CAP@ucsb.EDU", "\tcap@ucsb.edu\n"]) {
        const res = await callRoute(requestAction, emailRequest({ email }), h.context());
        expect(res.response!.headers.get("Location")).toBe("/email/sent");
      }
      await h.flush();
      const keys = limitSpy.mock.calls
        .map(([arg]) => (arg as { key: string }).key)
        .filter((k) => k.startsWith("email-request-address:"));
      expect(keys.length).toBe(4);
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).not.toContain("cap@ucsb.edu");
    } finally {
      limitSpy.mockRestore();
    }
    expect(h.sent.length).toBe(3);
    expect(h.sent.every((m) => m.to === "cap@ucsb.edu")).toBe(true);
    const rows = await env.AUTH_DB.prepare(
      "SELECT email FROM email_login_tokens WHERE email = ?",
    )
      .bind("cap@ucsb.edu")
      .all();
    expect(rows.results.length).toBe(3);
  });

  it("a capped request leaves the last link usable", async () => {
    const h = makeHarness();
    let last = "";
    for (let i = 0; i < 3; i++) last = await requestLink(h, "keep@ucsb.edu");
    const res = await callRoute(requestAction, emailRequest({ email: "keep@ucsb.edu" }), h.context());
    expect(res.response!.headers.get("Location")).toBe("/email/sent");
    await h.flush();
    expect(h.sent.length).toBe(3);
    const ok = await signIn(h, last, "Keep");
    expect(extractSessionCookie(ok.response!)).not.toBeNull();
  });

  it("the hourly cap resets after an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-11-09T08:00:00Z").getTime();
    vi.setSystemTime(t0);
    const h = makeHarness();
    for (let i = 0; i < 3; i++) await requestLink(h, "hourly@ucsb.edu");
    vi.setSystemTime(t0 + 60 * 60 * 1000 + 1);
    await requestLink(h, "hourly@ucsb.edu");
    expect(h.sent.length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// return_to and Host handling
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — return_to and Host", () => {
  const abuse = [
    "//evil.example",
    "\\evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "%2F%2Fevil.example",
    "/%2F%2Fevil.example",
    "%5Cevil.example",
    "https://evil.example/",
    "http:evil.example",
  ];

  for (const value of abuse) {
    it(`never leaves the app origin for return_to=${JSON.stringify(value)}`, async () => {
      const h = makeHarness();
      const token = await requestLink(h, `rt-${abuse.indexOf(value)}@ucsb.edu`, { return_to: value });
      const res = await signIn(h, token, "Return");
      const loc = res.response!.headers.get("Location")!;
      expect(new URL(loc).origin).toBe(APP_ORIGIN);
    });
  }

  it("keeps a valid return_to", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "rt-ok@ucsb.edu", { return_to: "/paleography/groups?x=1" });
    const res = await signIn(h, token, "Return");
    expect(res.response!.headers.get("Location")).toBe(`${APP_ORIGIN}/paleography/groups?x=1`);
  });

  it("falls back to /auth without a return_to", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "rt-none@ucsb.edu");
    const res = await signIn(h, token, "Return");
    expect(res.response!.headers.get("Location")).toBe(`${APP_ORIGIN}/auth`);
  });

  it("validates return_to again on use (a tampered stored value is still refused)", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "rt-db@ucsb.edu", { return_to: "/fine" });
    await env.AUTH_DB.prepare("UPDATE email_login_tokens SET return_to = ? WHERE id = ?")
      .bind("//evil.example/steal", hashHex(token))
      .run();
    const res = await signIn(h, token, "Return");
    expect(new URL(res.response!.headers.get("Location")!).origin).toBe(APP_ORIGIN);
  });

  it("builds the link and the redirect from APP_URL, never the Host header", async () => {
    const h = makeHarness();
    const res = await callRoute(
      requestAction,
      emailRequest({ email: "host@ucsb.edu" }, { urlOrigin: "https://evil.example" }),
      h.context(),
    );
    expect(res.response!.headers.get("Location")).toBe("/email/sent");
    await h.flush();
    const msg = h.sent[0];
    expect(msg.url.startsWith(`${APP_ORIGIN}/auth/email/verify?token=`)).toBe(true);
    expect(msg.url).not.toContain("evil.example");

    const token = tokenFromMessage(msg);
    const signed = await signIn(h, token, "Host", { urlOrigin: "https://evil.example" });
    expect(new URL(signed.response!.headers.get("Location")!).origin).toBe(APP_ORIGIN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Accounts that sign in with GitHub
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — GitHub accounts", () => {
  it("an address with a github_id gets the GitHub notice, no usable token and no session", async () => {
    const userId = await seedUser("octo@ucsb.edu", "octocat", { githubId: 880101 });
    const h = makeHarness();
    const res = await callRoute(requestAction, emailRequest({ email: "Octo@ucsb.edu" }), h.context());
    expect(res.response!.headers.get("Location")).toBe("/email/sent");
    await h.flush();

    expect(h.sent.length).toBe(1);
    const msg = h.sent[0];
    expect(msg.to).toBe("octo@ucsb.edu");
    expect(msg.kind).toBe("github-notice");
    expect(msg.url).toBe(`${APP_ORIGIN}/auth/login`);

    const usable = await env.AUTH_DB.prepare(
      "SELECT COUNT(*) AS n FROM email_login_tokens WHERE email = ? AND consumed_at IS NULL",
    )
      .bind("octo@ucsb.edu")
      .first<{ n: number }>();
    expect(usable!.n).toBe(0);
    expect(await sessionCount(userId)).toBe(0);
  });

  it("GitHub notices count toward the hourly cap", async () => {
    await seedUser("octo-cap@ucsb.edu", "octocap", { githubId: 880102 });
    const h = makeHarness();
    for (let i = 0; i < 4; i++) {
      await callRoute(requestAction, emailRequest({ email: "octo-cap@ucsb.edu" }), h.context());
    }
    await h.flush();
    expect(h.sent.length).toBe(3);
  });

  it("a link issued before the account was linked to GitHub no longer signs it in", async () => {
    const h = makeHarness();
    const first = await requestLink(h, "later-gh@ucsb.edu");
    await signIn(h, first, "Later");
    const token = await requestLink(h, "later-gh@ucsb.edu");
    const user = await userByEmail("later-gh@ucsb.edu");
    await getDb()
      .update(schema.users)
      .set({ githubId: 880103, handle: "latergh" })
      .where(eq(schema.users.id, user!.id));

    const get = await callRoute(verifyLoader, verifyGet(token), h.context());
    expect(get.data.state).toBe("github");
    const res = await signIn(h, token);
    expect(res.response && extractSessionCookie(res.response)).toBeFalsy();
    expect(res.data.state).toBe("github");
    expect(await sessionCount(user!.id)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — logging", () => {
  it("never logs a token or a link, even when the send fails", async () => {
    const logged: string[] = [];
    const capture = (...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(capture),
    );
    try {
      const failing = makeHarness({}, { ok: false, reason: "error", detail: "boom" });
      await callRoute(requestAction, emailRequest({ email: "quiet@ucsb.edu" }), failing.context());
      await failing.flush();
      const token = tokenFromMessage(failing.sent[0]);

      const h = makeHarness();
      const throwing = makeHarness();
      throwing.send.mockRejectedValueOnce(new Error("binding down"));
      await callRoute(requestAction, emailRequest({ email: "quiet2@ucsb.edu" }), throwing.context());
      await throwing.flush();

      await signIn(h, token, "Quiet");
      await signIn(h, token, "Quiet");

      const all = logged.join("\n");
      expect(all).not.toContain(token);
      expect(all).not.toContain(hashHex(token));
      expect(all).not.toContain("email/verify?token");
      expect(all).not.toContain("quiet@ucsb.edu");
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plus-addressing shares one limit
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — plus-addressing", () => {
  it("person+1, person+2 ... share one rate-limit key and one hourly cap", async () => {
    const h = makeHarness();
    const limitSpy = vi.spyOn(env.AUTH_RATE_LIMITER, "limit");
    try {
      for (const email of ["plus+1@ucsb.edu", "plus+2@ucsb.edu", "PLUS@ucsb.edu", "plus+x+y@ucsb.edu"]) {
        const res = await callRoute(requestAction, emailRequest({ email }), h.context());
        expect(res.response!.headers.get("Location")).toBe("/email/sent");
      }
      await h.flush();
      const keys = limitSpy.mock.calls
        .map(([arg]) => (arg as { key: string }).key)
        .filter((k) => k.startsWith("email-request-address:"));
      expect(keys.length).toBe(4);
      expect(new Set(keys).size).toBe(1);
    } finally {
      limitSpy.mockRestore();
    }
    expect(h.sent.length).toBe(3);
    // The sign-in identity stays the full address.
    expect(h.sent.map((m) => m.to)).toEqual(["plus+1@ucsb.edu", "plus+2@ucsb.edu", "plus@ucsb.edu"]);
  });

  it("a link for person+1 signs in person+1, not person", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "tagged+1@ucsb.edu");
    await signIn(h, token, "Tagged");
    expect(await userByEmail("tagged+1@ucsb.edu")).toBeDefined();
    expect(await userByEmail("tagged@ucsb.edu")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Races inside one verification
// ─────────────────────────────────────────────────────────────────────────────

describe("email sign-in — races inside a verification", () => {
  async function linkToGithub(email: string, githubId: number) {
    await env.AUTH_DB.prepare("UPDATE users SET github_id = ?, handle = 'linked' WHERE email = ?")
      .bind(githubId, email)
      .run();
  }

  it("a returning user linked to GitHub between lookup and write gets no session", async () => {
    const h = makeHarness();
    await signIn(h, await requestLink(h, "late-link@ucsb.edu"), "Late Link");
    const user = await userByEmail("late-link@ucsb.edu");
    const token = await requestLink(h, "late-link@ucsb.edu");

    const result = await completeEmailSignIn(h.env, { token, name: null }, {
      beforeWrite: () => linkToGithub("late-link@ucsb.edu", 990001),
    });
    expect(result.kind).toBe("github");
    expect(await sessionCount(user!.id)).toBe(1);
    const row = await userByEmail("late-link@ucsb.edu");
    expect(row!.githubId).toBe(990001);
  });

  it("a first sign-in whose new row is linked to GitHub before the write gets no session", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "late-new@ucsb.edu");
    const result = await completeEmailSignIn(h.env, { token, name: "Late New" }, {
      beforeWrite: () => linkToGithub("late-new@ucsb.edu", 990002),
    });
    expect(result.kind).toBe("github");
    const user = await userByEmail("late-new@ucsb.edu");
    expect(await sessionCount(user!.id)).toBe(0);
  });

  it("reads the clock when it uses the token: a link that expires during the request is refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-11-09T15:00:00Z").getTime();
    vi.setSystemTime(t0);
    const h = makeHarness();
    const token = await requestLink(h, "expiring@ucsb.edu");
    vi.setSystemTime(t0 + FIFTEEN_MINUTES - 1);
    const result = await completeEmailSignIn(h.env, { token, name: "Expiring" }, {
      beforeConsume: async () => {
        vi.setSystemTime(t0 + FIFTEEN_MINUTES + 1);
      },
    });
    expect(result.kind).toBe("invalid");
    expect(await userByEmail("expiring@ucsb.edu")).toBeUndefined();
  });

  it("a link superseded during the request is refused", async () => {
    const h = makeHarness();
    const token = await requestLink(h, "superseded@ucsb.edu");
    const result = await completeEmailSignIn(h.env, { token, name: "Superseded" }, {
      beforeConsume: async () => {
        await requestLink(h, "superseded@ucsb.edu");
      },
    });
    expect(result.kind).toBe("invalid");
  });

  it("supersession does not depend on clock order: an older link stays dead even if a later clock reads earlier", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-11-09T16:00:00Z").getTime();
    vi.setSystemTime(t0);
    const h = makeHarness();
    const older = await requestLink(h, "skew@ucsb.edu");
    vi.setSystemTime(t0 + 1000);
    await requestLink(h, "skew@ucsb.edu");
    // A different isolate whose clock reads slightly behind.
    vi.setSystemTime(t0 + 500);
    const res = await signIn(h, older, "Skew");
    expect(res.response).toBeNull();
    expect(res.data.state).toBe("invalid");
  });
});
