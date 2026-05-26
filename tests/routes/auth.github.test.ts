/**
 * GitHub OAuth start tests
 *
 * These tests cover `app/routes/auth.github.tsx` — the route that kicks off
 * GitHub sign-in by redirecting the browser to GitHub's authorize endpoint.
 * They verify that on a normal HTTPS request it issues a 302 to GitHub carrying
 * the state and requested scope, and sets the short-lived `github_oauth_state`
 * and `github_return_to` cookies with the right protections (HttpOnly, Secure,
 * SameSite=Lax, a ten-minute lifetime, scoped to `/auth`). They confirm the
 * flow uses plain state rather than PKCE, so no `code_challenge` leaks into the
 * redirect. They check that over plain HTTP in local dev the same cookies drop
 * the Secure attribute (or browsers would refuse them), that two consecutive
 * starts produce different state values so the CSRF token has real entropy, and
 * that when the rate limiter or missing OAuth secrets block the flow it
 * redirects to an error page instead of leaking a raw 500.
 *
 * @version v0.1.0
 */

import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/context";
import { parseSetCookie } from "../helpers/cookies";

// ---------------------------------------------------------------------------
// arctic mock — vi.hoisted ensures the mock factory is available before imports.
// ---------------------------------------------------------------------------
vi.mock("arctic", async () => {
  const actual = await vi.importActual<typeof import("arctic")>("arctic");
  return {
    ...actual,
    GitHub: vi.fn().mockImplementation(() => ({
      createAuthorizationURL: () =>
        new URL("https://github.com/login/oauth/authorize?scope=read%3Auser+user%3Aemail&state=teststate"),
    })),
  };
});

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

async function callLoader(url: string): Promise<Response> {
  // Import after mocking so the loader sees the mocked arctic
  const { loader } = await import("~/routes/auth.github");
  const request = new Request(url);
  const ctx = buildContext();
  let thrown: unknown;
  try {
    await loader({ request, context: ctx, params: {} } as any);
  } catch (err) {
    thrown = err;
  }
  if (!(thrown instanceof Response)) {
    throw new Error(`loader did not throw a Response; got: ${String(thrown)}`);
  }
  return thrown;
}

/** Returns all Set-Cookie headers from a Response. */
function getAllSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
}

describe("auth.github loader", () => {
  it("G1: HTTPS origin redirects to github.com/login/oauth/authorize with state + scope cookies, no code_challenge", async () => {
    const resp = await callLoader("https://ampl.tools/auth/github");

    // 302 redirect to GitHub
    expect(resp.status).toBe(302);
    const location = resp.headers.get("Location");
    expect(location).not.toBeNull();
    expect(location).toContain("github.com/login/oauth/authorize");

    // NO code_challenge — state-only
    expect(location).not.toContain("code_challenge");

    // Cookies
    const setCookies = getAllSetCookies(resp);
    expect(setCookies.length).toBeGreaterThanOrEqual(2);

    let stateCookie: ReturnType<ReturnType<typeof parseSetCookie>["get"]>;
    let returnToCookie: ReturnType<ReturnType<typeof parseSetCookie>["get"]>;
    for (const raw of setCookies) {
      const parsed = parseSetCookie(raw);
      if (parsed.has("github_oauth_state")) stateCookie = parsed.get("github_oauth_state");
      if (parsed.has("github_return_to")) returnToCookie = parsed.get("github_return_to");
    }

    // State cookie attrs
    expect(stateCookie).toBeDefined();
    expect(stateCookie!.value.length).toBeGreaterThan(0);
    expect(stateCookie!.attrs).toHaveProperty("httponly", true);
    expect(stateCookie!.attrs).toHaveProperty("secure", true);
    expect((stateCookie!.attrs["samesite"] as string).toLowerCase()).toBe("lax");
    expect(stateCookie!.attrs).toHaveProperty("max-age", "600");
    expect(stateCookie!.attrs).toHaveProperty("path", "/auth");

    // return_to cookie present
    expect(returnToCookie).toBeDefined();
    expect(returnToCookie!.attrs).toHaveProperty("httponly", true);
    expect(returnToCookie!.attrs).toHaveProperty("secure", true);
    expect((returnToCookie!.attrs["samesite"] as string).toLowerCase()).toBe("lax");
    expect(returnToCookie!.attrs).toHaveProperty("max-age", "600");
    expect(returnToCookie!.attrs).toHaveProperty("path", "/auth");
  });

  it("G2: HTTP origin (dev) emits cookies WITHOUT Secure", async () => {
    const resp = await callLoader("http://localhost:8787/auth/github");

    const setCookies = getAllSetCookies(resp);
    expect(setCookies.length).toBeGreaterThanOrEqual(2);

    let stateCookie: ReturnType<ReturnType<typeof parseSetCookie>["get"]>;
    let returnToCookie: ReturnType<ReturnType<typeof parseSetCookie>["get"]>;
    for (const raw of setCookies) {
      const parsed = parseSetCookie(raw);
      if (parsed.has("github_oauth_state")) stateCookie = parsed.get("github_oauth_state");
      if (parsed.has("github_return_to")) returnToCookie = parsed.get("github_return_to");
    }

    // Both cookies must NOT have Secure on HTTP
    expect(stateCookie).toBeDefined();
    expect(stateCookie!.attrs).not.toHaveProperty("secure");

    expect(returnToCookie).toBeDefined();
    expect(returnToCookie!.attrs).not.toHaveProperty("secure");

    // Other attrs still present
    expect(stateCookie!.attrs).toHaveProperty("httponly", true);
    expect((stateCookie!.attrs["samesite"] as string).toLowerCase()).toBe("lax");
    expect(stateCookie!.attrs).toHaveProperty("max-age", "600");
    expect(stateCookie!.attrs).toHaveProperty("path", "/auth");
  });

  it("G3: two consecutive calls produce different state cookie values (entropy)", async () => {
    const r1 = await callLoader("https://ampl.tools/auth/github");
    const r2 = await callLoader("https://ampl.tools/auth/github");

    function readStateCookie(resp: Response): string | undefined {
      for (const raw of getAllSetCookies(resp)) {
        const parsed = parseSetCookie(raw);
        const entry = parsed.get("github_oauth_state");
        if (entry) return entry.value;
      }
    }

    const s1 = readStateCookie(r1);
    const s2 = readStateCookie(r2);
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s1).not.toBe(s2);
  });

  it("G4: rate-limited → redirects to /login?error=rate-limited (not to GitHub)", async () => {
    const limitSpy = vi.spyOn(env.AUTH_RATE_LIMITER, "limit").mockResolvedValueOnce({ success: false });
    try {
      const resp = await callLoader("https://ampl.tools/auth/github");
      expect(resp.status).toBeGreaterThanOrEqual(300);
      expect(resp.status).toBeLessThan(400);
      const location = resp.headers.get("Location");
      expect(location).toContain("/login?error=rate-limited");
      expect(location).not.toContain("/auth/login"); // basename double-prefix guard
      expect(location).not.toContain("github.com");
    } finally {
      limitSpy.mockRestore();
    }
  });

  it("G5: missing secrets -> redirect to /login?error=oauth-failed, not a raw 500", async () => {
    const { loader } = await import("~/routes/auth.github");
    // Mask the two OAuth secrets while preserving every other binding
    // (AUTH_RATE_LIMITER is checked before the secrets branch).
    const envNoSecrets = new Proxy(env as unknown as Record<string, unknown>, {
      get(target, prop) {
        if (prop === "GITHUB_CLIENT_ID" || prop === "GITHUB_CLIENT_SECRET") return undefined;
        return Reflect.get(target, prop);
      },
    });
    const ctx = new RouterContextProvider();
    ctx.set(cloudflareContext, {
      env: envNoSecrets,
      ctx: {
        waitUntil: () => {},
        passThroughOnException: () => {},
        props: {},
      } as unknown as ExecutionContext,
    } as any);

    const request = new Request("https://ampl.tools/auth/github");
    let thrown: unknown;
    try {
      await loader({ request, context: ctx, params: {} } as any);
    } catch (err) {
      thrown = err;
    }
    // Must be a redirect Response — NOT a thrown Error (raw 500).
    expect(thrown).toBeInstanceOf(Response);
    const location = (thrown as Response).headers.get("Location");
    expect(location).toContain("/login?error=oauth-failed");
    expect(location).not.toContain("/auth/login"); // basename double-prefix guard
    expect(location).not.toContain("github.com");
  });
});
