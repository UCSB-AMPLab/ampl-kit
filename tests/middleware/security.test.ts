/**
 * Content-Security-Policy header tests
 *
 * These tests cover the security middleware's Content-Security-Policy header,
 * focusing on the `img-src` directive. They prove two things that have to hold
 * together: the policy must allow `https://avatars.githubusercontent.com` so
 * GitHub profile avatars actually load in the account widget, and it must do so
 * without a `*` wildcard — a wildcard would let any origin serve images, which
 * defeats the point of the policy. The middleware is driven directly with a
 * minimal mock request and context and a trivial `next()` that returns a blank
 * 200, then the resulting CSP header is inspected — no browser DOM needed.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { securityMiddleware } from "~/middleware/security";

/**
 * Build a minimal middleware call: a context with a fake nonce slot and a
 * `next()` that returns a plain 200 response. Returns the CSP header value.
 */
async function runSecurityMiddleware(): Promise<string> {
  // Build a context Map shim that satisfies context.set / context.get calls.
  // securityMiddleware only uses context.set(nonceContext, nonce) — the Map
  // shim is sufficient. Cast through unknown to avoid TypeScript's structural
  // overlap check on the full DataFunctionArgs shape.
  const contextMap = new Map<unknown, unknown>();
  const context = {
    set: (key: unknown, value: unknown) => { contextMap.set(key, value); },
    get: (key: unknown) => contextMap.get(key),
  };

  const request = new Request("https://ampl.tools/auth/");
  const next = async () => new Response(null, { status: 200 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = securityMiddleware as unknown as (args: any, next: any) => Promise<Response>;
  const response = await fn({ request, context }, next);

  return response.headers.get("Content-Security-Policy") ?? "";
}

describe("securityMiddleware CSP", () => {
  it("S1: includes https://avatars.githubusercontent.com in img-src", async () => {
    const csp = await runSecurityMiddleware();
    expect(csp).toContain("img-src");
    expect(csp).toContain("https://avatars.githubusercontent.com");
  });

  it("S2: img-src does not contain a wildcard (*)", async () => {
    const csp = await runSecurityMiddleware();
    // Extract the img-src directive value.
    const imgSrcMatch = csp.match(/img-src ([^;]+)/);
    const imgSrc = imgSrcMatch ? imgSrcMatch[1] : "";
    expect(imgSrc).not.toContain("*");
  });
});
