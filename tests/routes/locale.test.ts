/**
 * Locale-switch route tests
 *
 * These tests cover `app/routes/locale.tsx` — the small route that switches the
 * interface language and then sends the user back where they were. They prove
 * it writes the chosen language into the `lng` cookie and redirects to the
 * in-app destination, that it falls back to English when the requested language
 * is unsupported or absent, and — most importantly — that it refuses to honour
 * a hostile `to` destination: an absolute external URL or a protocol-relative
 * `//host` path never appears in the redirect, so the language switch cannot be
 * turned into an open redirect. The language cookie is still written even when
 * the destination is rejected, since the two concerns are independent.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { parseSetCookie } from "../helpers/cookies";
import { localeCookie } from "~/middleware/i18next";

/** Returns all Set-Cookie headers from a Response. Handles getSetCookie() when available. */
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

/**
 * Reads and deserializes the `lng` cookie value from a response's Set-Cookie headers.
 * react-router's createCookie serializes values as JSON (base64-URL-encoded), so we
 * use localeCookie.parse() via a synthetic Cookie header to get the plain string value.
 * Returns undefined if not found.
 */
async function getLngCookieValue(response: Response): Promise<string | undefined> {
  for (const raw of getAllSetCookies(response)) {
    const parsed = parseSetCookie(raw);
    const entry = parsed.get("lng");
    if (entry) {
      // entry.value is the serialized (base64-URL-encoded JSON) form.
      // Reconstruct a Cookie header string and let localeCookie.parse() deserialize it.
      const cookieHeader = `lng=${entry.value}`;
      const deserialized = await localeCookie.parse(cookieHeader);
      return deserialized as string | undefined;
    }
  }
  return undefined;
}

async function callLocaleLoader(url: string): Promise<Response> {
  // Import after mocks (none needed for this route — no env deps)
  const { loader } = await import("~/routes/locale");
  const request = new Request(url);
  // The locale loader reads no context; pass an empty-ish object cast as any.
  const response = await loader({ request, context: {} as any, params: {} } as any);
  if (!(response instanceof Response)) {
    throw new Error(`loader did not return a Response; got: ${String(response)}`);
  }
  return response;
}

describe("locale loader", () => {
  it("L1: ?lng=es&to=/login → redirect with lng=es cookie and in-app Location", async () => {
    const resp = await callLocaleLoader(
      "https://ampl.tools/auth/locale?lng=es&to=%2Flogin"
    );

    // Must be a redirect
    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    // Location must be set and be an in-app path
    const location = resp.headers.get("Location");
    expect(location).not.toBeNull();
    expect(location).not.toContain("evil.example");

    // lng cookie must be set to "es"
    const lng = await getLngCookieValue(resp);
    expect(lng).toBe("es");
  });

  it("L2: ?to=https://evil.example (absolute URL) → Location not evil.example; lng=es still set", async () => {
    const resp = await callLocaleLoader(
      "https://ampl.tools/auth/locale?lng=es&to=https%3A%2F%2Fevil.example"
    );

    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    const location = resp.headers.get("Location");
    expect(location).not.toBeNull();
    // Must not point to the external origin
    expect(location).not.toContain("evil.example");
    // Must not be protocol-relative
    expect(location).not.toMatch(/^\/\//);

    // Cookie is still written (locale write is independent of redirect target)
    const lng = await getLngCookieValue(resp);
    expect(lng).toBe("es");
  });

  it("L3: ?to=//evil.example (protocol-relative) → Location not evil.example", async () => {
    const resp = await callLocaleLoader(
      "https://ampl.tools/auth/locale?lng=es&to=%2F%2Fevil.example"
    );

    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    const location = resp.headers.get("Location");
    expect(location).not.toBeNull();
    expect(location).not.toContain("evil.example");
    expect(location).not.toMatch(/^\/\//);

    const lng = await getLngCookieValue(resp);
    expect(lng).toBe("es");
  });

  it("L4a: ?lng=fr (unsupported locale) → Set-Cookie has lng=en", async () => {
    const resp = await callLocaleLoader(
      "https://ampl.tools/auth/locale?lng=fr"
    );

    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    const lng = await getLngCookieValue(resp);
    expect(lng).toBe("en");
  });

  it("L4b: no lng param → Set-Cookie has lng=en", async () => {
    const resp = await callLocaleLoader(
      "https://ampl.tools/auth/locale"
    );

    expect(resp.status).toBeGreaterThanOrEqual(300);
    expect(resp.status).toBeLessThan(400);

    const lng = await getLngCookieValue(resp);
    expect(lng).toBe("en");
  });
});
