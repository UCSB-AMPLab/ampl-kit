/**
 * GitHub OAuth helper tests
 *
 * These tests cover `app/lib/github-auth.server.ts` — the thin layer that wraps
 * the `arctic` OAuth library for GitHub sign-in. They check that
 * `createGitHubClient` builds a real client from the app's credentials without
 * throwing, that `buildRedirectUri` derives the correct `/auth/callback`
 * absolute URL from the incoming request's origin (so the callback always
 * matches what GitHub was told), and that the re-exported `generateState` is a
 * working function. Getting the redirect URI right matters because a mismatch
 * would break the OAuth handshake entirely.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import * as arctic from "arctic";
import {
  createGitHubClient,
  buildRedirectUri,
  generateState,
} from "~/lib/github-auth.server";

describe("createGitHubClient", () => {
  it("returns an arctic.GitHub instance without throwing", () => {
    const client = createGitHubClient(
      "test-client-id",
      "test-client-secret",
      "https://ampl.tools/auth/callback",
    );
    expect(client).toBeInstanceOf(arctic.GitHub);
  });

  it("accepts null redirectUri", () => {
    // arctic.GitHub constructor accepts string | null for redirectURI
    const client = createGitHubClient(
      "test-client-id",
      "test-client-secret",
      null as unknown as string,
    );
    expect(client).toBeInstanceOf(arctic.GitHub);
  });
});

describe("buildRedirectUri", () => {
  it("builds an absolute URL ending in /auth/callback for a standard origin", () => {
    const result = buildRedirectUri("https://ampl.tools/auth/github");
    expect(result).toBe("https://ampl.tools/auth/callback");
  });

  it("preserves the origin from the request URL", () => {
    const result = buildRedirectUri("https://staging.ampl.tools/auth/github?foo=bar");
    expect(result).toBe("https://staging.ampl.tools/auth/callback");
  });

  it("returns an absolute https URL (not relative)", () => {
    const result = buildRedirectUri("https://ampl.tools/auth/github");
    expect(result).toMatch(/^https:\/\//);
  });

  it("path ends with /auth/callback (not /auth/google/callback or bare /callback)", () => {
    const result = buildRedirectUri("https://ampl.tools/auth/github");
    expect(result).toContain("/auth/callback");
    expect(result).not.toContain("/auth/google/callback");
  });
});

describe("generateState", () => {
  it("is a function (re-exported from arctic)", () => {
    expect(typeof generateState).toBe("function");
  });

  it("returns a non-empty string", () => {
    const state = generateState();
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);
  });
});
