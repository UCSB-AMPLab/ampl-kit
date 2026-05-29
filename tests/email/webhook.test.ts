/**
 * Webhook handler integration tests
 *
 * Tests the handleWebhook() function against the EMAIL_DB harness. Each test
 * constructs a Request with proper Svix-signed headers (using the fixture
 * RESEND_WEBHOOK_SECRET = "whsec_dGVzdHNlY3JldA==") and calls the handler
 * directly, then asserts on the Response status and resulting DB state.
 *
 * Cases covered:
 *   - Valid signature bounce payload → 200 + suppressions row with reason "bounce"
 *   - Valid signature complaint payload → 200 + suppressions row with reason "complaint"
 *   - Invalid Svix signature → 403, ZERO suppressions rows written
 *   - Cross-check: isSuppressed() returns true after a bounce webhook
 *   - Rate limit exceeded → 429
 *
 * Run under vitest.email.config.ts (EMAIL_DB + drizzle-email migrations).
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getEmailDb, schema } from "../helpers/email-db";
import { handleWebhook } from "../../app/email/routes/webhook";
import { isSuppressed } from "../../app/email/lib/suppression";

// ---------------------------------------------------------------------------
// Svix signing helper — replicates the server-side algorithm so
// tests can generate valid and invalid signatures without importing svix npm.
// ---------------------------------------------------------------------------

async function signSvix(
  id: string,
  timestamp: string,
  body: string,
  secret: string, // whsec_... value
): Promise<string> {
  const keyBytes = Uint8Array.from(
    atob(secret.replace("whsec_", "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${id}.${timestamp}.${body}`;
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signed),
  );
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `v1,${b64}`;
}

function makeBouncePayload(address: string): string {
  return JSON.stringify({
    type: "email.bounced",
    data: {
      email_id: "test-email-001",
      to: address,
    },
  });
}

function makeComplaintPayload(address: string): string {
  return JSON.stringify({
    type: "email.complained",
    data: {
      email_id: "test-email-002",
      to: address,
    },
  });
}

async function makeSignedRequest(
  body: string,
  secret: string,
  overrideSig?: string,
  ip?: string,
): Promise<Request> {
  const id = "msg_test_" + Date.now();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = overrideSig ?? (await signSvix(id, timestamp, body, secret));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": sig,
  };
  if (ip) headers["CF-Connecting-IP"] = ip;

  return new Request("https://ampl.tools/email/webhook", {
    method: "POST",
    headers,
    body,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleWebhook — valid bounce", () => {
  it("returns 200 and inserts a suppressions row with reason 'bounce'", async () => {
    const address = `bounce-${Date.now()}@example.com`;
    const body = makeBouncePayload(address);
    const req = await makeSignedRequest(body, env.RESEND_WEBHOOK_SECRET);
    const res = await handleWebhook(req, env);

    expect(res.status).toBe(200);

    const db = getEmailDb();
    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();

    expect(row).toBeDefined();
    expect(row?.reason).toBe("bounce");
    expect(row?.source).toBe("resend_webhook");
  });
});

describe("handleWebhook — valid complaint", () => {
  it("returns 200 and inserts a suppressions row with reason 'complaint'", async () => {
    const address = `complaint-${Date.now()}@example.com`;
    const body = makeComplaintPayload(address);
    const req = await makeSignedRequest(body, env.RESEND_WEBHOOK_SECRET);
    const res = await handleWebhook(req, env);

    expect(res.status).toBe(200);

    const db = getEmailDb();
    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();

    expect(row).toBeDefined();
    expect(row?.reason).toBe("complaint");
    expect(row?.source).toBe("resend_webhook");
  });
});

describe("handleWebhook — invalid signature", () => {
  it("returns 403 and writes ZERO suppressions rows for a bad signature", async () => {
    const address = `bad-sig-${Date.now()}@example.com`;
    const body = makeBouncePayload(address);
    const db = getEmailDb();

    // Use a forged signature
    const req = await makeSignedRequest(body, env.RESEND_WEBHOOK_SECRET, "v1,AAAAAAAAAAAAAAAA");
    const res = await handleWebhook(req, env);

    expect(res.status).toBe(403);

    // No suppression row should have been written
    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();
    expect(row).toBeUndefined();
  });

  it("does not write any rows when signature is entirely absent", async () => {
    const address = `no-sig-${Date.now()}@example.com`;
    const body = makeBouncePayload(address);
    const db = getEmailDb();

    const req = new Request("https://ampl.tools/email/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const res = await handleWebhook(req, env);

    expect(res.status).toBeGreaterThanOrEqual(400);

    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, address))
      .get();
    expect(row).toBeUndefined();
  });
});

describe("handleWebhook — suppression cross-check", () => {
  it("isSuppressed returns true after a bounce webhook", async () => {
    const address = `cross-check-${Date.now()}@example.com`;
    const body = makeBouncePayload(address);
    const req = await makeSignedRequest(body, env.RESEND_WEBHOOK_SECRET);

    const db = getEmailDb();
    const before = await isSuppressed(db, address);
    expect(before).toBe(false);

    await handleWebhook(req, env);

    const after = await isSuppressed(db, address);
    expect(after).toBe(true);
  });
});

describe("handleWebhook — rate limiting", () => {
  it("returns 429 when rate limiter rejects", async () => {
    const limitingEnv = {
      ...env,
      EMAIL_RATE_LIMITER: { limit: async () => ({ success: false }) },
    } as unknown as Env;

    const body = makeBouncePayload("rate-limited@example.com");
    const req = new Request("https://ampl.tools/email/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const res = await handleWebhook(req, limitingEnv);
    expect(res.status).toBe(429);
  });
});

describe("handleWebhook — idempotency", () => {
  it("returns 200 for a repeat bounce of an already-suppressed address", async () => {
    const address = `repeat-bounce-${Date.now()}@example.com`;
    const body = makeBouncePayload(address);

    // Use distinct IPs so each call starts fresh in its rate-limit bucket
    const ip1 = `10.1.1.${Date.now() % 200}`;
    const ip2 = `10.1.2.${Date.now() % 200}`;

    const req1 = await makeSignedRequest(body, env.RESEND_WEBHOOK_SECRET, undefined, ip1);
    const res1 = await handleWebhook(req1, env);
    expect(res1.status).toBe(200);

    // Second call for the same address — insert-or-ignore should not error
    const req2 = await makeSignedRequest(body, env.RESEND_WEBHOOK_SECRET, undefined, ip2);
    const res2 = await handleWebhook(req2, env);
    expect(res2.status).toBe(200);
  });
});
