/**
 * Resend webhook handler — POST /email/webhook
 *
 * This file handles incoming Resend bounce/complaint webhook events. For each
 * event it:
 *   1. Rate-limits by IP (EMAIL_RATE_LIMITER) — returns 429 if exceeded
 *   2. Reads the raw request body as text (never request.json() — the Svix
 *      signature covers the exact original bytes)
 *   3. Verifies the Svix HMAC-SHA256 signature — returns 403 BEFORE any DB write
 *   4. Parses the JSON body and branches on event type
 *   5. Inserts an address into suppressions with insert-or-ignore semantics
 *      (a repeat bounce for an already-suppressed address succeeds with 200)
 *
 * @version v0.1.0
 */

import { verifySvixSignature } from "../lib/svix-verify";
import { getEmailDb } from "../db/client.email";
import { schema } from "../db/client.email";
import { normalizeEmail } from "../lib/suppression";
import { logError } from "../../lib/logging.server";

/**
 * Shape of Resend bounce/complaint webhook payloads.
 * https://resend.com/docs/webhooks/emails/bounced
 * https://resend.com/docs/webhooks/emails/complained
 */
interface ResendWebhookPayload {
  type: string;
  data: {
    email_id?: string;
    to?: string;
    email?: string;
    [key: string]: unknown;
  };
}

/**
 * Handle a POST /email/webhook request from Resend.
 *
 * @param request - the incoming Request (raw body read here)
 * @param env     - the Worker's Env bindings
 */
export async function handleWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  // 1. Per-IP rate limit
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const limiter = await env.EMAIL_RATE_LIMITER.limit({ key: ip });
  if (!limiter.success) {
    return new Response("Too Many Requests", { status: 429 });
  }

  try {
    // 2. Read raw body — MUST be text(), never json() (the Svix signature
    //    covers the exact original bytes)
    const rawBody = await request.text();

    // 3. Verify Svix signature BEFORE any DB write. The secret is provisioned
    //    via `wrangler secret put`; not auto-typed on Env.
    const { RESEND_WEBHOOK_SECRET } = env as unknown as {
      RESEND_WEBHOOK_SECRET?: string;
    };
    // Fail closed on a misconfigured environment: an unset secret must reject
    // the event (server error) rather than reach signature verification with an
    // empty key. Never accept an unverified webhook.
    if (!RESEND_WEBHOOK_SECRET) {
      logError(new Error("RESEND_WEBHOOK_SECRET missing"), {
        action: "email.webhook.secret",
      });
      return new Response("Internal Server Error", { status: 500 });
    }
    const valid = await verifySvixSignature(
      rawBody,
      request.headers,
      RESEND_WEBHOOK_SECRET,
    );
    if (!valid) {
      return new Response("Forbidden", { status: 403 });
    }

    // 4. Parse the event
    let payload: ResendWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as ResendWebhookPayload;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // 5. Determine suppression reason from event type
    let reason: "bounce" | "complaint" | null = null;
    if (payload.type === "email.bounced") {
      reason = "bounce";
    } else if (payload.type === "email.complained") {
      reason = "complaint";
    }

    if (!reason) {
      // Unknown event type — acknowledge without suppressing
      return new Response("OK", { status: 200 });
    }

    // Extract the recipient address (Resend webhook uses data.to)
    const address = payload.data?.to ?? payload.data?.email ?? "";
    if (!address) {
      return new Response("Bad Request: missing recipient address", {
        status: 400,
      });
    }

    // 6. Insert into suppressions — insert-or-ignore semantics:
    //    if the address is already suppressed, catch the UNIQUE violation
    //    and treat it as success (idempotent webhook delivery).
    const db = getEmailDb(env);
    try {
      await db.insert(schema.suppressions).values({
        address: normalizeEmail(address),
        reason,
        source: "resend_webhook",
        createdAt: Date.now(),
      });
    } catch (err) {
      // Swallow UNIQUE constraint violation — address already suppressed
      const msg =
        err instanceof Error ? err.message : String(err);
      const causeMsg =
        err instanceof Error && err.cause instanceof Error
          ? err.cause.message
          : "";
      const isUnique =
        msg.includes("UNIQUE constraint failed") ||
        causeMsg.includes("UNIQUE constraint failed");
      if (!isUnique) throw err;
      // Already suppressed — not an error
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    logError(error, { action: "email.webhook" });
    return new Response("Internal Server Error", { status: 500 });
  }
}
