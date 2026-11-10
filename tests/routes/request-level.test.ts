/**
 * Request-level tests through the Worker's fetch handler
 *
 * The other route tests call `loader` and `action` functions directly, so they
 * never reach React Router's own request handling. These tests send real
 * `Request`s to the default export of `workers/app.ts`, which runs the whole
 * handler: routing, the framework's CSRF check on form posts, middleware,
 * server rendering and the security headers. The server build is assembled by
 * `tests/helpers/server-build.ts`, which reads `allowedActionOrigins` from
 * `react-router.config.ts`.
 *
 * Pages are served with `Referrer-Policy: no-referrer`, so browsers send
 * `Origin: null` on their own form posts. Without `allowedActionOrigins:
 * ["null"]`, the framework refuses those posts on routes that have a
 * component (the name form on `/auth/email/verify` answered with an empty 500).
 *
 * @version v0.1.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/app";
import { env } from "cloudflare:test";
import { issueToken, sha256Hex } from "~/lib/email-login.server";
import {
  APP_ORIGIN,
  flushAllHarnesses,
  makeHarness,
  stubTurnstile,
  uniqueIp,
  type Harness,
} from "../helpers/email-login";

let fetchSpy: ReturnType<typeof stubTurnstile>;

beforeEach(() => {
  fetchSpy = stubTurnstile();
});

afterEach(async () => {
  await flushAllHarnesses();
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});

interface PostShape {
  origin?: string | null;
  site?: string | null;
}

/** Sends a form POST through the Worker. Header defaults match a browser under no-referrer. */
async function post(h: Harness, path: string, fields: Record<string, string>, shape: PostShape = {}) {
  const headers = new Headers({
    "CF-Connecting-IP": uniqueIp(),
    "Content-Type": "application/x-www-form-urlencoded",
  });
  const origin = shape.origin === undefined ? "null" : shape.origin;
  const site = shape.site === undefined ? "same-origin" : shape.site;
  if (origin !== null) headers.set("Origin", origin);
  if (site !== null) headers.set("Sec-Fetch-Site", site);
  const request = new Request(new URL(path, APP_ORIGIN), {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException() {},
    props: {},
  };
  const response = await worker.fetch(request as any, h.env, ctx as unknown as ExecutionContext);
  await Promise.all(pending);
  return response;
}

async function tokenRow(raw: string) {
  return env.AUTH_DB
    .prepare("SELECT consumed_at FROM email_login_tokens WHERE id = ?")
    .bind(sha256Hex(raw))
    .first<{ consumed_at: number | null }>();
}

async function seedToken(h: Harness, email: string): Promise<string> {
  const raw = await issueToken(h.env.AUTH_DB, { email, returnTo: "/", locale: "en" });
  if (!raw) throw new Error("token not issued");
  return raw;
}

describe("POST /auth/email/verify through the Worker", () => {
  it("Origin: null + same-origin with an invalid token → 400 HTML page", async () => {
    const h = makeHarness();
    const res = await post(h, "/auth/email/verify", { token: "0".repeat(64), name: "Ana" });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("<html");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("Origin: null + same-origin with a valid token and a name → 302 and a session cookie", async () => {
    const h = makeHarness();
    const token = await seedToken(h, "request-level@ucsb.edu");
    const res = await post(h, "/auth/email/verify", { token, name: "Ana Pérez" });
    expect(res.status).toBe(302);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("__Host-ampl_session="))).toBe(true);
    expect((await tokenRow(token))?.consumed_at).not.toBeNull();
  });

  it("Origin: null + cross-site → 403", async () => {
    const h = makeHarness();
    const token = await seedToken(h, "cross-site@ucsb.edu");
    const res = await post(h, "/auth/email/verify", { token, name: "Eve" }, { site: "cross-site" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect((await tokenRow(token))?.consumed_at).toBeNull();
  });

  it("no Origin and no Sec-Fetch-Site → 403", async () => {
    const h = makeHarness();
    const token = await seedToken(h, "no-headers@ucsb.edu");
    const res = await post(h, "/auth/email/verify", { token, name: "Eve" }, { origin: null, site: null });
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect((await tokenRow(token))?.consumed_at).toBeNull();
  });

  it("a foreign Origin is refused: no session, token not consumed", async () => {
    const h = makeHarness();
    const token = await seedToken(h, "evil-origin@ucsb.edu");
    const res = await post(
      h,
      "/auth/email/verify",
      { token, name: "Eve" },
      { origin: "https://evil.example", site: "same-origin" },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect((await tokenRow(token))?.consumed_at).toBeNull();
  });
});

describe("other POST routes through the Worker", () => {
  it("POST /auth/email/request with the same-origin shape reaches the action", async () => {
    const h = makeHarness();
    const res = await post(h, "/auth/email/request", {
      email: "someone@ucsb.edu",
      "cf-turnstile-response": "turnstile-test-token",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/\/email\/sent$|\/login/);
  });

  it("POST /auth/logout cross-site → 403; same-origin Origin: null → redirect", async () => {
    const h = makeHarness();
    const blocked = await post(h, "/auth/logout", {}, { site: "cross-site" });
    expect(blocked.status).toBe(403);
    const ok = await post(h, "/auth/logout", {});
    expect(ok.status).toBe(302);
  });

  it("POST /auth/ping cross-site → 403", async () => {
    const h = makeHarness();
    const res = await post(h, "/auth/ping", { note: "x" }, { site: "cross-site" });
    expect(res.status).toBe(403);
  });
});
