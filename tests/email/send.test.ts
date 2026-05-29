/**
 * EmailWorker send() integration tests
 *
 * Tests the full `send()` pipeline against the EMAIL_DB harness and a fake
 * Resend transport. Each test case stubs the global `fetch` to intercept the
 * POST to `https://api.resend.com/emails` so no real network call is made.
 *
 * Cases covered:
 *   1. Happy path: non-suppressed address, under quota → sends row inserted,
 *      Resend fake called exactly once, { ok: true, id } returned.
 *   2. Identity: the `from` field sent to Resend is always
 *      "AMPL <noreply@ampl.tools>"; the send-log row records the tool.
 *   3. Headers + footer: the Resend payload headers contain List-Unsubscribe
 *      and List-Unsubscribe-Post; html and text both contain <!--ampl-footer-->.
 *   4. Suppression: send() to a seeded-suppressed address returns
 *      { ok: false, reason: "suppressed" } with zero Resend calls.
 *   5. Idempotency: two send() calls with the same idempotencyKey → one Resend
 *      call, second returns the first id.
 *   6. Quota: with the daily guard exceeded, send() returns
 *      { ok: false, reason: "quota_exceeded" } with zero Resend calls.
 *
 * @version v0.1.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getEmailDb, schema } from "../helpers/email-db";
import { checkQuota } from "../../app/email/lib/quota";
import type { SendMessage } from "../../app/email/types";

// ---------------------------------------------------------------------------
// Resend fetch fake helpers
// ---------------------------------------------------------------------------

type ResendPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

/** Captured Resend calls — populated by the fetch fake. */
let resendCalls: ResendPayload[] = [];

/** A fake Resend response id to return from the mock. */
const FAKE_RESEND_ID = "resend-fake-id-001";

/**
 * Install a global fetch fake that intercepts POST to api.resend.com.
 * Non-Resend requests pass through (or would in a real env; here they just
 * use the same mock since we have no real network).
 */
function installResendFake() {
  resendCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.resend.com/emails") {
        const body = JSON.parse((init?.body as string) ?? "{}") as ResendPayload;
        resendCalls.push(body);
        return new Response(JSON.stringify({ id: FAKE_RESEND_ID }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    }),
  );
}

function uninstallResendFake() {
  vi.unstubAllGlobals();
}

/**
 * Install a fetch fake whose Resend call fails (HTTP 500), so callResend
 * throws. Used by the transport-failure regression test.
 */
function installResendFailFake() {
  resendCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.resend.com/emails") {
        const body = JSON.parse((init?.body as string) ?? "{}") as ResendPayload;
        resendCalls.push(body);
        return new Response("upstream boom", { status: 500 });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    }),
  );
}

// ---------------------------------------------------------------------------
// Shared message fixture
// ---------------------------------------------------------------------------

const BASE_MSG: SendMessage = {
  to: "recipient@example.com",
  subject: "[Calamus] Test invitation",
  html: "<p>Hello</p>",
  text: "Hello",
  tool: "calamus",
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("EmailWorker send()", () => {
  let db: ReturnType<typeof getEmailDb>;

  beforeEach(() => {
    db = getEmailDb();
    installResendFake();
  });

  afterEach(() => {
    uninstallResendFake();
  });

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------
  it("happy path: sends row inserted, Resend called once, returns { ok: true, id }", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const result = await worker.send({ ...BASE_MSG });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("result.ok should be true");
    expect(result.id).toBe(FAKE_RESEND_ID);
    expect(resendCalls).toHaveLength(1);

    // The sends row should exist with status "sent"
    const row = await db
      .select()
      .from(schema.sends)
      .where(eq(schema.sends.resendId, FAKE_RESEND_ID))
      .get();
    expect(row).toBeDefined();
    expect(row?.status).toBe("sent");
  });

  // -------------------------------------------------------------------------
  // 2. Identity
  // -------------------------------------------------------------------------
  it("identity: from is always 'AMPL <noreply@ampl.tools>'; send-log records tool", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    await worker.send({ ...BASE_MSG, tool: "scheduling" });

    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].from).toBe("AMPL <noreply@ampl.tools>");

    const row = await db
      .select()
      .from(schema.sends)
      .where(eq(schema.sends.resendId, FAKE_RESEND_ID))
      .get();
    expect(row?.tool).toBe("scheduling");
  });

  // -------------------------------------------------------------------------
  // 3. Headers + footer
  // -------------------------------------------------------------------------
  it("stamps List-Unsubscribe headers and <!--ampl-footer--> in html and text", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    await worker.send({ ...BASE_MSG });

    expect(resendCalls).toHaveLength(1);
    const payload = resendCalls[0];

    // Headers
    expect(payload.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/ampl\.tools\/email\/unsubscribe\?token=/,
    );
    expect(payload.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );

    // Footer marker
    expect(payload.html).toContain("<!--ampl-footer-->");
    expect(payload.text).toContain("---");
  });

  // -------------------------------------------------------------------------
  // 4. Suppression
  // -------------------------------------------------------------------------
  it("suppressed address: returns { ok:false, reason:'suppressed' }, zero Resend calls", async () => {
    const now = Date.now();
    await db.insert(schema.suppressions).values({
      address: "suppressed@example.com",
      reason: "bounce",
      source: "resend_webhook",
      createdAt: now,
    });

    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const result = await worker.send({
      ...BASE_MSG,
      to: "suppressed@example.com",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("result.ok should be false");
    expect(result.reason).toBe("suppressed");
    expect(resendCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5. Idempotency
  // -------------------------------------------------------------------------
  it("duplicate idempotency key: second call returns first id, one Resend call total", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const first = await worker.send({
      ...BASE_MSG,
      idempotencyKey: "test-idem-key-001",
    });
    const second = await worker.send({
      ...BASE_MSG,
      idempotencyKey: "test-idem-key-001",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("both sends should succeed");

    // Same id returned
    expect(second.id).toBe(first.id);
    // Only one Resend call made
    expect(resendCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 6. Quota
  // -------------------------------------------------------------------------
  it("daily quota exceeded: returns { ok:false, reason:'quota_exceeded' }, zero Resend calls", async () => {
    // Seed 90 sent rows today to trip the daily guard
    const now = Date.now();
    const rows = Array.from({ length: 90 }, (_, i) => ({
      tool: "calamus" as const,
      recipient: `user${i}@ampl.tools`,
      subject: `[Calamus] Quota seed ${i}`,
      status: "sent",
      sentAt: now,
      createdAt: now,
    }));
    for (const row of rows) {
      await db.insert(schema.sends).values(row);
    }

    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const result = await worker.send({ ...BASE_MSG });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("result.ok should be false");
    expect(result.reason).toBe("quota_exceeded");
    expect(resendCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe("EmailWorker send() — regression tests", () => {
  let db: ReturnType<typeof getEmailDb>;

  beforeEach(() => {
    db = getEmailDb();
    installResendFake();
  });

  afterEach(() => {
    uninstallResendFake();
  });

  // A Resend failure must NOT leave a phantom "sent" row. The row is
  // marked "failed" (excluded from quota), and a retry with the same
  // idempotency key re-attempts delivery and can succeed.
  it("a Resend failure marks the row 'failed', preserves the key for retry, and never reports a false success", async () => {
    uninstallResendFake();
    installResendFailFake();

    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const failed = await worker.send({
      ...BASE_MSG,
      to: "cr01@example.com",
      idempotencyKey: "cr01-retry-key",
    });

    // The send reports failure, NOT { ok: true }
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("failed send should not be ok");
    expect(failed.reason).toBe("error");
    expect(resendCalls).toHaveLength(1);

    // The persisted row is "failed" with no resend id — not a phantom "sent".
    const afterFail = await db
      .select()
      .from(schema.sends)
      .where(eq(schema.sends.idempotencyKey, "cr01-retry-key"));
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0].status).toBe("failed");
    expect(afterFail[0].resendId).toBeNull();

    // A failed delivery does not count toward the quota.
    expect(await checkQuota(db, { monthly: 2500, daily: 90 })).toBe("ok");

    // Retry with the same key now re-drives delivery and succeeds.
    uninstallResendFake();
    installResendFake();
    const retried = await worker.send({
      ...BASE_MSG,
      to: "cr01@example.com",
      idempotencyKey: "cr01-retry-key",
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("retry should succeed");
    expect(retried.id).toBe(FAKE_RESEND_ID);
    expect(resendCalls).toHaveLength(1);

    // Still exactly one row for the key, now "sent".
    const afterRetry = await db
      .select()
      .from(schema.sends)
      .where(eq(schema.sends.idempotencyKey, "cr01-retry-key"));
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0].status).toBe("sent");
    expect(afterRetry[0].resendId).toBe(FAKE_RESEND_ID);
  });

  // A multi-recipient send is rejected before any Resend call, since
  // the single unsubscribe token cannot bind to more than one recipient.
  it("rejects a multi-recipient send without contacting Resend", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const result = await worker.send({
      ...BASE_MSG,
      to: ["one@example.com", "two@example.com"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("multi-recipient send should be rejected");
    expect(result.reason).toBe("error");
    expect(result.detail).toBe("multi_recipient_unsupported");
    expect(resendCalls).toHaveLength(0);
  });

  // A missing/malformed quota ceiling must fail closed, not silently
  // disable the quota (Number("x") === NaN; count >= NaN is always false).
  it("a malformed quota ceiling fails closed with a config error and sends nothing", async () => {
    const badEnv = {
      ...env,
      MONTHLY_QUOTA_CEILING: "not-a-number",
    } as unknown as Env;

    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, badEnv);

    const result = await worker.send({ ...BASE_MSG, to: "wr06@example.com" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("malformed ceiling should fail closed");
    expect(result.reason).toBe("error");
    expect(result.detail).toBe("configuration_error");
    expect(resendCalls).toHaveLength(0);
  });

  // If Resend returns 2xx with no `id` field, deliver() must throw
  // (not silently write { resendId: undefined } and return { ok: true, id: undefined }).
  it("a 2xx Resend response with no id field is treated as an error", async () => {
    uninstallResendFake();
    // Fake that returns 2xx but with an empty body (no id)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://api.resend.com/emails") {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch to: ${url}`);
      }),
    );

    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const result = await worker.send({ ...BASE_MSG, to: "wr05@example.com" });

    // Must NOT return { ok: true } with an undefined id
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("missing Resend id should not be a success");
    expect(result.reason).toBe("error");
  });

  // Suppression matching is case-insensitive: a send to a
  // differently-cased suppressed address is blocked.
  it("a send to a differently-cased suppressed address is blocked", async () => {
    await db.insert(schema.suppressions).values({
      address: "case@example.com",
      reason: "bounce",
      source: "resend_webhook",
      createdAt: Date.now(),
    });

    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const result = await worker.send({ ...BASE_MSG, to: "CASE@Example.COM" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("differently-cased address should be suppressed");
    expect(result.reason).toBe("suppressed");
    expect(resendCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Missing-secret fail-closed guards (parity with the auth Worker).
//
// send() must refuse to deliver if any required secret is unset/empty rather
// than signing the unsubscribe token with a guessable key or calling Resend
// with an "undefined" Bearer token. A misconfigured deployment fails closed
// with detail "configuration_error" and makes ZERO Resend calls.
// ---------------------------------------------------------------------------

describe("EmailWorker send() — missing-secret guards", () => {
  beforeEach(() => installResendFake());
  afterEach(() => uninstallResendFake());

  it("returns configuration_error and makes zero Resend calls when UNSUB_HMAC_SECRET is unset", async () => {
    const noSecretEnv = {
      ...env,
      UNSUB_HMAC_SECRET: undefined,
    } as unknown as Env;
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, noSecretEnv);

    const result = await worker.send({
      ...BASE_MSG,
      to: `cfgerr-unsub-${Date.now()}@example.com`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("send should fail closed on a missing secret");
    expect(result.reason).toBe("error");
    expect(result.detail).toBe("configuration_error");
    expect(resendCalls).toHaveLength(0);
  });

  it("returns configuration_error and makes zero Resend calls when RESEND_API_KEY is unset", async () => {
    const noSecretEnv = {
      ...env,
      RESEND_API_KEY: "",
    } as unknown as Env;
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, noSecretEnv);

    const result = await worker.send({
      ...BASE_MSG,
      to: `cfgerr-apikey-${Date.now()}@example.com`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("send should fail closed on a missing secret");
    expect(result.reason).toBe("error");
    expect(result.detail).toBe("configuration_error");
    expect(resendCalls).toHaveLength(0);
  });
});
