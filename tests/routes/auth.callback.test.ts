/**
 * GitHub OAuth callback tests
 *
 * These tests cover `app/routes/auth.callback.tsx` — the route GitHub redirects
 * to once a user has approved sign-in, and the most security-sensitive step in
 * the whole flow. They walk the full range of outcomes: the happy paths where a
 * new user is inserted or a returning user's profile is updated to exactly one
 * row and a session is minted; the rejections that must never let a user
 * through — a mismatched or missing state cookie (CSRF guard), an account with
 * no verified email, GitHub reporting that the user cancelled or that something
 * failed, and the token exchange itself throwing; the rate-limit case; and the
 * redirect handling that has to land on an absolute URL without ever
 * double-prefixing `/auth`, including when the stored `return_to` cookie is
 * malformed. The `arctic` library is mocked so no real GitHub calls happen, and
 * `global.fetch` is spied per test to stand in for GitHub's REST responses.
 *
 * @version v0.1.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:test";
import { RouterContextProvider } from "react-router";

// ── Module-level mock of arctic ──────────────────────────────────────────────
const { validateAuthorizationCodeMock } = vi.hoisted(() => ({
  validateAuthorizationCodeMock: vi.fn(),
}));

vi.mock("arctic", async () => {
  const actual = await vi.importActual<typeof import("arctic")>("arctic");
  return {
    ...actual,
    GitHub: vi.fn().mockImplementation(() => ({
      createAuthorizationURL: () =>
        new URL("https://github.com/login/oauth/authorize"),
      validateAuthorizationCode: validateAuthorizationCodeMock,
    })),
  };
});

import { loader } from "~/routes/auth.callback";
import { cloudflareContext } from "~/context";
import * as schema from "~/db/schema";
import { getDb, seedUser } from "../helpers/db";
import { extractSessionCookie } from "../helpers/cookies";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

let __ipCounter = 0;
function uniqueIp(): string {
  __ipCounter += 1;
  return `10.2.0.${__ipCounter}`;
}

interface CallbackOpts {
  state?: string;
  code?: string;
  errorParam?: string;
  stateCookieValue?: string;
  returnToCookie?: string;
  noCookieHeader?: boolean;
  origin?: string;
}

function buildRequest(opts: CallbackOpts = {}): Request {
  const origin = opts.origin ?? "https://example.test";
  const u = new URL("/auth/callback", origin);
  if (opts.errorParam) u.searchParams.set("error", opts.errorParam);
  if (opts.code !== undefined) u.searchParams.set("code", opts.code);
  if (opts.state !== undefined) u.searchParams.set("state", opts.state);

  const headers = new Headers();
  headers.set("CF-Connecting-IP", uniqueIp());
  if (!opts.noCookieHeader) {
    const cookieParts: string[] = [];
    if (opts.stateCookieValue !== undefined) {
      cookieParts.push(`github_oauth_state=${opts.stateCookieValue}`);
    }
    if (opts.returnToCookie !== undefined) {
      cookieParts.push(`github_return_to=${encodeURIComponent(opts.returnToCookie)}`);
    }
    if (cookieParts.length > 0) {
      headers.set("Cookie", cookieParts.join("; "));
    }
  }
  return new Request(u.toString(), { headers });
}

async function callLoader(opts: CallbackOpts = {}): Promise<Response> {
  const request = buildRequest(opts);
  const ctx = buildContext();
  let thrown: unknown;
  let returned: unknown;
  try {
    returned = await loader({ request, context: ctx, params: {} } as any);
  } catch (err) {
    thrown = err;
  }
  if (thrown instanceof Response) return thrown;
  if (returned instanceof Response) return returned;
  throw new Error(
    `loader did not return/throw a Response (returned: ${String(returned)}, thrown: ${String(thrown)})`,
  );
}

/** Sets up validateAuthorizationCode to return a mock access token. */
function setTokensOk(accessToken = "mock-access-token") {
  validateAuthorizationCodeMock.mockResolvedValueOnce({
    accessToken: () => accessToken,
  });
}

/** Sets up validateAuthorizationCode to throw an error. */
function setTokensThrows(message = "token exchange failed") {
  validateAuthorizationCodeMock.mockRejectedValueOnce(new Error(message));
}

/** Installs a fetch spy that returns GitHub /user and /user/emails responses. */
function installFetchSpy(opts: {
  githubId?: number;
  login?: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  primaryVerified?: boolean;
  userOk?: boolean;
  emailsOk?: boolean;
} = {}) {
  const {
    githubId = 12345,
    login = "alice",
    name = "Alice",
    avatarUrl = "https://avatars.githubusercontent.com/u/12345",
    email = "alice@example.com",
    primaryVerified = true,
    userOk = true,
    emailsOk = true,
  } = opts;

  return vi.spyOn(global, "fetch").mockImplementation(
    async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/user/emails")) {
        return new Response(
          JSON.stringify([
            {
              email,
              primary: primaryVerified,
              verified: primaryVerified,
              visibility: "private",
            },
          ]),
          { status: emailsOk ? 200 : 403 },
        );
      }
      // /user endpoint
      return new Response(
        JSON.stringify({
          id: githubId,
          login,
          name,
          avatar_url: avatarUrl,
        }),
        { status: userOk ? 200 : 403 },
      );
    },
  );
}

// Shared default valid-request opts (state + code + cookies matching).
const VALID_OPTS: CallbackOpts = {
  state: "test-state-abc",
  code: "auth-code-123",
  stateCookieValue: "test-state-abc",
  returnToCookie: "",
};

beforeEach(() => {
  validateAuthorizationCodeMock.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("auth.callback - happy paths", () => {
  it("C1: new user — INSERT row; session minted; OAuth cookies cleared", async () => {
    const fetchSpy = installFetchSpy({ githubId: 99001, login: "newuser-c1", email: "c1@example.com" });
    try {
      setTokensOk();
      const resp = await callLoader({ ...VALID_OPTS, returnToCookie: "" });

      // Should redirect (3xx)
      expect(resp.status).toBeGreaterThanOrEqual(300);
      expect(resp.status).toBeLessThan(400);

      // Session cookie minted
      const sessionCookie = extractSessionCookie(resp);
      expect(sessionCookie).not.toBeNull();
      expect(
        sessionCookie?.name === "__Host-ampl_session" ||
          sessionCookie?.name === "ampl_session",
      ).toBe(true);

      // DB row created
      const db = getDb();
      const row = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.githubId, 99001))
        .get();
      expect(row).toBeDefined();
      expect(row?.handle).toBe("newuser-c1");
      expect(row?.email).toBe("c1@example.com");

      // OAuth cookies cleared (Max-Age=0)
      const setCookies = (
        resp.headers as Headers & { getSetCookie?: () => string[] }
      ).getSetCookie?.() ?? [resp.headers.get("set-cookie") ?? ""];
      const joined = setCookies.join("\n");
      expect(joined).toContain("github_oauth_state=");
      expect(joined).toContain("github_return_to=");
      expect(joined).toContain("Max-Age=0");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("C2: returning user — UPDATE profile; exactly ONE row for github_id (no duplicate)", async () => {
    // Seed an existing user with the same githubId
    const existingGithubId = 99002;
    await seedUser("c2-old@example.com", "oldhandle-c2", { githubId: existingGithubId });

    const fetchSpy = installFetchSpy({
      githubId: existingGithubId,
      login: "newhandle-c2",
      name: "Alice Updated",
      email: "c2-new@example.com",
    });
    try {
      setTokensOk();
      const resp = await callLoader({ ...VALID_OPTS });

      expect(resp.status).toBeGreaterThanOrEqual(300);
      expect(resp.status).toBeLessThan(400);

      // Session cookie minted
      const sessionCookie = extractSessionCookie(resp);
      expect(sessionCookie).not.toBeNull();

      const db = getDb();
      // Exactly ONE row for this githubId — no duplicate
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.githubId, existingGithubId))
        .all();
      expect(rows.length).toBe(1);

      // Profile updated
      expect(rows[0].handle).toBe("newhandle-c2");
      expect(rows[0].name).toBe("Alice Updated");
      expect(rows[0].email).toBe("c2-new@example.com");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("auth.callback - state validation", () => {
  it("C3: state mismatch → /auth/login?error=state-mismatch; no token exchange", async () => {
    const resp = await callLoader({
      state: "URL-STATE",
      code: "auth-code",
      stateCookieValue: "DIFFERENT-COOKIE-STATE",
    });
    const loc = resp.headers.get("Location");
    expect(loc).toContain("/login?error=state-mismatch");
    expect(loc).not.toContain("/auth/login"); // basename double-prefix guard
    expect(validateAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("C3b: no Cookie header → /auth/login?error=state-mismatch", async () => {
    const resp = await callLoader({
      state: "any",
      code: "any",
      noCookieHeader: true,
    });
    expect(resp.headers.get("Location")).toContain("/login?error=state-mismatch");
  });
});

describe("auth.callback - email / claim rejections", () => {
  it("C4: no primary verified email → /auth/login?error=no-verified-email", async () => {
    const fetchSpy = installFetchSpy({ primaryVerified: false });
    try {
      setTokensOk();
      const resp = await callLoader({ ...VALID_OPTS });
      const c4loc = resp.headers.get("Location");
      expect(c4loc).toContain("/login?error=no-verified-email");
      expect(c4loc).not.toContain("/auth/login"); // basename double-prefix guard
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("auth.callback - GitHub-side errors", () => {
  it("C5: ?error=access_denied → /auth/login?error=oauth-cancelled", async () => {
    const resp = await callLoader({ errorParam: "access_denied" });
    expect(resp.headers.get("Location")).toContain("/login?error=oauth-cancelled");
  });

  it("C6: ?error=server_error → /auth/login?error=oauth-failed", async () => {
    const resp = await callLoader({ errorParam: "server_error" });
    expect(resp.headers.get("Location")).toContain("/login?error=oauth-failed");
  });

  it("C7: arctic throws on token exchange → /auth/login?error=oauth-failed", async () => {
    setTokensThrows();
    const resp = await callLoader({ ...VALID_OPTS });
    expect(resp.headers.get("Location")).toContain("/login?error=oauth-failed");
  });
});

describe("auth.callback - rate limit", () => {
  it("C8: rate-limit miss → /auth/login?error=rate-limited; OAuth cookies cleared", async () => {
    const spy = vi
      .spyOn(env.AUTH_RATE_LIMITER, "limit")
      .mockResolvedValueOnce({ success: false });
    try {
      const resp = await callLoader({ ...VALID_OPTS });
      expect(resp.headers.get("Location")).toContain("/login?error=rate-limited");

      const setCookies = (
        resp.headers as Headers & { getSetCookie?: () => string[] }
      ).getSetCookie?.() ?? [resp.headers.get("set-cookie") ?? ""];
      const joined = setCookies.join("\n");
      expect(joined).toContain("github_oauth_state=");
      expect(joined).toContain("Max-Age=0");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("auth.callback - absolute redirect", () => {
  it("C9: valid return_to → Location is absolute, contains path, no /auth prefix", async () => {
    const fetchSpy = installFetchSpy({ githubId: 99009, login: "user-c9", email: "c9@example.com" });
    try {
      setTokensOk();
      const resp = await callLoader({
        ...VALID_OPTS,
        returnToCookie: "/palaeography/dashboard",
        origin: "https://example.test",
      });

      const loc = resp.headers.get("Location");
      // Must be an absolute URL
      expect(loc).toMatch(/^https?:\/\//);
      // Must contain the return path
      expect(loc).toContain("/palaeography/dashboard");
      // Must NOT double-prefix /auth
      expect(loc).not.toContain("/auth/palaeography");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("C10: absent return_to → Location is absolute and ends /auth (not /auth/auth)", async () => {
    const fetchSpy = installFetchSpy({ githubId: 99010, login: "user-c10", email: "c10@example.com" });
    try {
      setTokensOk();
      const resp = await callLoader({
        ...VALID_OPTS,
        returnToCookie: "",   // empty return_to → falls back to BASENAME
        origin: "https://example.test",
      });

      const loc = resp.headers.get("Location");
      // Must be absolute
      expect(loc).toMatch(/^https?:\/\//);
      // Must end with /auth (the BASENAME fallback)
      expect(loc).toMatch(/\/auth$/);
      // Must NOT double-prefix
      expect(loc).not.toContain("/auth/auth");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("C11: malformed return_to cookie -> redirect (no 500), session still minted", async () => {
    const fetchSpy = installFetchSpy({ githubId: 99011, login: "user-c11", email: "c11@example.com" });
    try {
      setTokensOk();
      // Build a request with a RAW, invalid %-encoded github_return_to cookie.
      // The shared buildRequest() encodeURIComponent()s the value, which would
      // mask the bug — so construct the Request directly with `%zz`.
      const u = new URL("/auth/callback", "https://example.test");
      u.searchParams.set("code", "auth-code-123");
      u.searchParams.set("state", "test-state-abc");
      const headers = new Headers();
      headers.set("CF-Connecting-IP", "10.9.9.211");
      headers.set("Cookie", "github_oauth_state=test-state-abc; github_return_to=%zz");
      const request = new Request(u.toString(), { headers });
      const ctx = buildContext();

      let thrown: unknown;
      let returned: unknown;
      try {
        returned = await loader({ request, context: ctx, params: {} } as any);
      } catch (err) {
        thrown = err;
      }
      const resp = (thrown instanceof Response ? thrown : returned) as Response;
      expect(resp).toBeInstanceOf(Response);

      // Must be a redirect — NOT a 500 from an unguarded URIError.
      expect(resp.status).toBeGreaterThanOrEqual(300);
      expect(resp.status).toBeLessThan(400);

      // Malformed cookie falls back to "" → safeReturnTo("/") → absolute /auth.
      const loc = resp.headers.get("Location");
      expect(loc).toMatch(/^https?:\/\//);
      expect(loc).toMatch(/\/auth$/);

      // The user is authenticated by this point — session must still be minted.
      const sessionCookie = extractSessionCookie(resp);
      expect(sessionCookie).not.toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
