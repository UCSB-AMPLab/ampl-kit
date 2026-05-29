/**
 * Unsubscribe token and handler integration tests
 *
 * Task 1 (token round-trip, covered by describe blocks below):
 *   - signUnsubToken + verifyUnsubToken round-trip returns the original address
 *   - A token with a tampered signature byte returns null
 *   - A token signed with a different secret returns null
 *
 * Task 2 (handler tests, added in the second describe blocks):
 *   - POST /email/unsubscribe with a valid token inserts a suppressions row
 *     (reason "unsubscribe", source "user_request") and returns 200
 *   - POST /email/unsubscribe with a forged/invalid token returns 4xx and
 *     writes no suppressions row
 *   - GET /email/unsubscribe returns 200 text/html containing both EN and ES
 *     marker strings, plus the expected security headers
 *
 * Tests run under vitest.email.config.ts (EMAIL_DB + drizzle-email migrations).
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getEmailDb, schema } from "../helpers/email-db";
import { signUnsubToken, verifyUnsubToken } from "../../app/email/lib/unsub-token";
import { handleUnsubscribe } from "../../app/email/routes/unsubscribe";

// ---------------------------------------------------------------------------
// Task 1: token round-trip tests
// ---------------------------------------------------------------------------

describe("verifyUnsubToken", () => {
  const SECRET = "test-unsub-hmac-secret-32bytes!!";
  const ALT_SECRET = "different-secret-also-32-bytes!!";
  const ADDRESS = "user@example.com";

  it("round-trip: verify returns the original address", async () => {
    const token = await signUnsubToken(ADDRESS, SECRET);
    const result = await verifyUnsubToken(token, SECRET);
    expect(result).toBe(ADDRESS);
  });

  it("returns null for a token with a tampered signature byte", async () => {
    const token = await signUnsubToken(ADDRESS, SECRET);
    // Flip one character in the signature part (after the last '.')
    const parts = token.split(".");
    const sig = parts[parts.length - 1];
    // Change the first char to something definitely different
    const tampered = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const tamperedToken = [...parts.slice(0, -1), tampered].join(".");
    const result = await verifyUnsubToken(tamperedToken, SECRET);
    expect(result).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await signUnsubToken(ADDRESS, SECRET);
    const result = await verifyUnsubToken(token, ALT_SECRET);
    expect(result).toBeNull();
  });

  it("returns null for a malformed token with no separator", async () => {
    const result = await verifyUnsubToken("notavalidtoken", SECRET);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 2: handleUnsubscribe handler tests
// ---------------------------------------------------------------------------

describe("handleUnsubscribe — GET", () => {
  it("returns 200 text/html containing both EN and ES marker strings", async () => {
    const token = await signUnsubToken("reader@example.com", env.UNSUB_HMAC_SECRET);
    const req = new Request(`https://ampl.tools/email/unsubscribe?token=${encodeURIComponent(token)}`);
    const res = await handleUnsubscribe(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);

    const body = await res.text();
    // Must contain both an EN and an ES string to satisfy bilingual requirement
    // The bilingual page uses temporary inline placeholder strings in Task 2;
    // the approved locale copy is wired in Task 3.
    expect(body).toMatch(/[Uu]nsubscribe/); // EN marker
    expect(body).toMatch(/baja|suscripci/i); // ES marker (dar de baja / suscripción)
  });

  it("returns X-Frame-Options: DENY security header", async () => {
    const token = await signUnsubToken("reader@example.com", env.UNSUB_HMAC_SECRET);
    const req = new Request(`https://ampl.tools/email/unsubscribe?token=${encodeURIComponent(token)}`);
    const res = await handleUnsubscribe(req, env);

    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("returns X-Content-Type-Options: nosniff security header", async () => {
    const token = await signUnsubToken("reader@example.com", env.UNSUB_HMAC_SECRET);
    const req = new Request(`https://ampl.tools/email/unsubscribe?token=${encodeURIComponent(token)}`);
    const res = await handleUnsubscribe(req, env);

    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns 429 when rate limiter rejects", async () => {
    // Mock env with a failing rate limiter
    const limitingEnv = {
      ...env,
      EMAIL_RATE_LIMITER: { limit: async () => ({ success: false }) },
    } as unknown as Env;

    const req = new Request("https://ampl.tools/email/unsubscribe?token=abc");
    const res = await handleUnsubscribe(req, limitingEnv);
    expect(res.status).toBe(429);
  });
});

describe("handleUnsubscribe — POST", () => {
  it("inserts a suppressions row with reason 'unsubscribe' for a valid token", async () => {
    const address = `unsub-post-${Date.now()}@example.com`;
    const token = await signUnsubToken(address, env.UNSUB_HMAC_SECRET);

    const req = new Request("https://ampl.tools/email/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    const res = await handleUnsubscribe(req, env);

    expect(res.status).toBe(200);

    // Verify suppression row was written
    const db = getEmailDb();
    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();

    expect(row).toBeDefined();
    expect(row?.reason).toBe("unsubscribe");
    expect(row?.source).toBe("user_request");
  });

  it("returns 4xx and writes no suppressions row for a forged token", async () => {
    const address = `forged-${Date.now()}@example.com`;
    const db = getEmailDb();

    const req = new Request("https://ampl.tools/email/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "forged.token.value" }).toString(),
    });
    const res = await handleUnsubscribe(req, env);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();

    expect(row).toBeUndefined();
  });

  it("returns 200 and does not error on repeat unsubscribe for same address", async () => {
    const address = `repeat-unsub-${Date.now()}@example.com`;
    const token = await signUnsubToken(address, env.UNSUB_HMAC_SECRET);
    // Use a distinct IP per call so each is within its own rate-limit bucket
    const ip1 = `10.0.1.${Date.now() % 200}`;
    const ip2 = `10.0.2.${Date.now() % 200}`;

    const makeReq = (ip: string, tok: string) =>
      new Request("https://ampl.tools/email/unsubscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": ip,
        },
        body: new URLSearchParams({ token: tok }).toString(),
      });

    const res1 = await handleUnsubscribe(makeReq(ip1, token), env);
    // Second call with a fresh token — same address already suppressed
    const newToken = await signUnsubToken(address, env.UNSUB_HMAC_SECRET);
    const res2 = await handleUnsubscribe(makeReq(ip2, newToken), env);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("returns 429 when rate limiter rejects", async () => {
    const limitingEnv = {
      ...env,
      EMAIL_RATE_LIMITER: { limit: async () => ({ success: false }) },
    } as unknown as Env;

    const req = new Request("https://ampl.tools/email/unsubscribe", {
      method: "POST",
      body: new URLSearchParams({ token: "anything" }).toString(),
    });
    const res = await handleUnsubscribe(req, limitingEnv);
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Missing-secret fail-closed guard
//
// If UNSUB_HMAC_SECRET is unset, the runtime would coerce `undefined` to the
// guessable string "undefined" as the HMAC key — an attacker could then forge
// a token with that known key and suppress an arbitrary address. The handler
// must refuse to process the request (500, no DB write) rather than verify a
// token under a guessable key.
// ---------------------------------------------------------------------------

describe("handleUnsubscribe — missing UNSUB_HMAC_SECRET", () => {
  it("returns 500 and writes no suppressions row when the secret is unset", async () => {
    const address = `missing-unsub-secret-${Date.now()}@example.com`;
    // A token that WOULD verify under the real secret; the guard must fire first.
    const token = await signUnsubToken(address, env.UNSUB_HMAC_SECRET);
    const noSecretEnv = {
      ...env,
      UNSUB_HMAC_SECRET: undefined,
    } as unknown as Env;

    const req = new Request("https://ampl.tools/email/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "CF-Connecting-IP": `10.9.1.${Date.now() % 200}`,
      },
      body: new URLSearchParams({ token }).toString(),
    });
    const res = await handleUnsubscribe(req, noSecretEnv);

    expect(res.status).toBe(500);

    const db = getEmailDb();
    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();
    expect(row).toBeUndefined();
  });

  it("rejects a token forged with the guessable 'undefined' key when the secret is unset", async () => {
    const address = `weak-key-forge-${Date.now()}@example.com`;
    // The attack: with the secret unset, an unguarded handler would HMAC with
    // the literal "undefined". The attacker forges a token using that key.
    const forged = await signUnsubToken(address, "undefined");
    const noSecretEnv = {
      ...env,
      UNSUB_HMAC_SECRET: undefined,
    } as unknown as Env;

    const req = new Request("https://ampl.tools/email/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "CF-Connecting-IP": `10.9.2.${Date.now() % 200}`,
      },
      body: new URLSearchParams({ token: forged }).toString(),
    });
    const res = await handleUnsubscribe(req, noSecretEnv);

    // Must NOT be a 200 suppression — the guard fails closed before verifying.
    expect(res.status).toBe(500);

    const db = getEmailDb();
    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();
    expect(row).toBeUndefined();
  });
});
