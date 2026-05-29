/**
 * ampl-email Worker entry point
 *
 * This file is the `main` entry for the `ampl-email` Worker declared in
 * `wrangler.email.jsonc`. It exports a `WorkerEntrypoint` subclass that
 * exposes two surfaces:
 *   1. `async send(msg)` — the service-binding RPC that consumer Workers call
 *      via `env.EMAIL.send(msg)`. The Resend API key never leaves this Worker.
 *      Pipeline order:
 *        (1) getEmailDb
 *        (2) isSuppressed → reject with { ok:false, reason:"suppressed" }
 *        (3) checkQuota   → reject with { ok:false, reason:"quota_exceeded" }
 *        (4) idempotency insert (UNIQUE gate) → dedup returns existing id
 *        (5) signUnsubToken + buildFooter + buildUnsubscribeHeaders
 *        (6) callResend
 *        (7) update sends row with resend_id; return { ok:true, id }
 *   2. `async fetch(request)` — serves the public HTTP routes:
 *        POST /email/webhook   — Resend bounce/complaint webhook (Svix-verified)
 *        GET  /email/unsubscribe — bilingual confirmation page
 *        POST /email/unsubscribe — HMAC-token-verified suppression
 *
 * Security headers (X-Frame-Options, HSTS, X-Content-Type-Options,
 * Referrer-Policy) are stamped on every HTTP response from fetch().
 *
 * @version v0.1.0
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { SendMessage, SendResult } from "../app/email/types";
import { getEmailDb, schema, type EmailDB } from "../app/email/db/client.email";
import { isSuppressed } from "../app/email/lib/suppression";
import { checkQuota } from "../app/email/lib/quota";
import { insertSendOrDedup } from "../app/email/lib/idempotency";
import { signUnsubToken } from "../app/email/lib/unsub-token";
import { buildFooter } from "../app/email/lib/footer";
import { callResend, type ResendPayload } from "../app/email/lib/resend";
import { handleWebhook } from "../app/email/routes/webhook";
import { handleUnsubscribe } from "../app/email/routes/unsubscribe";
import { logError } from "../app/lib/logging.server";

/** Build the RFC 8058 List-Unsubscribe header pair. */
function buildUnsubscribeHeaders(token: string): {
  "List-Unsubscribe": string;
  "List-Unsubscribe-Post": string;
} {
  return {
    "List-Unsubscribe": `<https://ampl.tools/email/unsubscribe?token=${encodeURIComponent(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Encode string or ArrayBuffer content to base64 for the Resend attachment API.
 *
 * String content is encoded via TextEncoder (never bare btoa(string)) to handle
 * UTF-8 content such as .ics files with Spanish accents without throwing.
 * ArrayBuffer content is wrapped in Uint8Array and encoded through the same
 * byte path.
 */
function encodeBase64(content: string | ArrayBuffer): string {
  if (typeof content === "string") {
    const bytes = new TextEncoder().encode(content);
    return encodeBase64FromBytes(bytes);
  }
  return encodeBase64FromBytes(new Uint8Array(content));
}

/** Build a binary string from raw bytes and base64-encode it. */
function encodeBase64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Stamp security headers onto an HTTP response. */
function addSecurityHeaders(response: Response): Response {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Strict-Transport-Security", "max-age=31536000");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export default class EmailWorker extends WorkerEntrypoint<Env> {
  // -------------------------------------------------------------------------
  // fetch() — public HTTP routes
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    // Rate-limit the two public endpoints
    if (
      url.pathname === "/email/webhook" ||
      url.pathname === "/email/unsubscribe"
    ) {
      const limiter = await this.env.EMAIL_RATE_LIMITER.limit({ key: ip });
      if (!limiter.success) {
        return addSecurityHeaders(
          new Response("Too Many Requests", { status: 429 }),
        );
      }
    }

    let response: Response;
    if (url.pathname === "/email/webhook") {
      response = await handleWebhook(request, this.env);
    } else if (url.pathname === "/email/unsubscribe") {
      response = await handleUnsubscribe(request, this.env);
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    return addSecurityHeaders(response);
  }

  // -------------------------------------------------------------------------
  // send() — service-binding RPC
  // -------------------------------------------------------------------------

  async send(msg: SendMessage): Promise<SendResult> {
    try {
      // (1) Open the email database
      const db = getEmailDb(this.env);
      const now = Date.now();

      // The worker currently delivers to a single recipient per call. The
      // compliance footer and List-Unsubscribe token are bound to one address;
      // a multi-recipient send (msg.to as an array of length > 1) would embed
      // one recipient's unsubscribe token in the mail delivered to the others,
      // so a secondary recipient clicking unsubscribe would suppress the
      // first. Reject it until per-recipient tokens are modelled. The
      // SendMessage.to type keeps `string[]` for forward-compatibility.
      const recipients = Array.isArray(msg.to) ? msg.to : [msg.to];
      if (recipients.length !== 1) {
        logError(new Error("multi-recipient send rejected"), {
          action: "email.send",
        });
        return {
          ok: false,
          reason: "error",
          detail: "multi_recipient_unsupported",
        };
      }
      const recipient = recipients[0];

      // (2) Suppression check (global). isSuppressed normalises the address.
      if (await isSuppressed(db, recipient)) {
        await db.insert(schema.sends).values({
          tool: msg.tool,
          recipient,
          subject: msg.subject,
          status: "suppressed",
          sentAt: now,
          createdAt: now,
        });
        return { ok: false, reason: "suppressed" };
      }

      // (3) Quota check — fail closed on a missing/malformed ceiling rather than
      // silently disabling the quota when Number(...) yields NaN (count >= NaN
      // is always false).
      const monthly = Number(this.env.MONTHLY_QUOTA_CEILING);
      const daily = Number(this.env.DAILY_QUOTA_CEILING);
      if (!Number.isFinite(monthly) || !Number.isFinite(daily)) {
        logError(new Error("invalid quota ceiling configuration"), {
          action: "email.send",
        });
        return { ok: false, reason: "error", detail: "configuration_error" };
      }
      const quotaResult = await checkQuota(db, { monthly, daily });
      if (quotaResult !== "ok") {
        await db.insert(schema.sends).values({
          tool: msg.tool,
          recipient,
          subject: msg.subject,
          status: "quota_exceeded",
          sentAt: now,
          createdAt: now,
        });
        return { ok: false, reason: "quota_exceeded", detail: quotaResult };
      }

      // (4) Idempotency insert — the UNIQUE constraint is the race-safe gate.
      // The row starts as "pending"; it only becomes "sent" after Resend
      // confirms delivery (see deliver()). A Resend failure therefore never
      // leaves a phantom "sent" row that would inflate the quota or make a
      // retry report a success that never happened.
      const { inserted, id } = await insertSendOrDedup(db, {
        tool: msg.tool,
        recipient,
        subject: msg.subject,
        status: "pending",
        idempotencyKey: msg.idempotencyKey ?? null,
        sentAt: now,
        createdAt: now,
      });

      if (!inserted) {
        // A row already exists for this idempotency key.
        const existing = await db
          .select({
            status: schema.sends.status,
            resendId: schema.sends.resendId,
          })
          .from(schema.sends)
          .where(eq(schema.sends.id, id))
          .get();

        // Genuine duplicate of a delivered email — return its id, no re-send.
        if (existing?.status === "sent" && existing.resendId) {
          return { ok: true, id: existing.resendId };
        }
        // A concurrent send for the same key is still in flight — do not send a
        // second copy; report the duplicate so the caller can retry later.
        if (existing?.status === "pending") {
          return { ok: false, reason: "duplicate", detail: "in_progress" };
        }
        // Otherwise the prior attempt failed and never delivered — fall through
        // to re-attempt delivery on the existing row id.
      }

      // (5) Deliver: stamp the compliance envelope, transport via Resend, and
      // reconcile the row to its terminal status.
      return await this.deliver(db, id, recipient, msg);
    } catch (error) {
      logError(error, { action: "email.send" });
      const detail =
        error instanceof Error ? error.message : "Unexpected error";
      return { ok: false, reason: "error", detail };
    }
  }

  /**
   * Build the unsubscribe token + compliance footer/headers, transport the mail
   * via Resend, and reconcile the `sends` row to its terminal status. Shared by
   * the fresh-insert path and the failed-retry path so a retried idempotency key
   * can still reach delivery. The row is marked "sent" only on a confirmed
   * Resend id, and "failed" on a transport error.
   */
  private async deliver(
    db: EmailDB,
    id: number,
    recipient: string,
    msg: SendMessage,
  ): Promise<SendResult> {
    const unsubToken = await signUnsubToken(
      recipient,
      this.env.UNSUB_HMAC_SECRET,
    );
    const unsubUrl = `https://ampl.tools/email/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const unsubHeaders = buildUnsubscribeHeaders(unsubToken);
    const footer = buildFooter(msg.locale ?? "en", unsubUrl);

    const payload: ResendPayload = {
      from: "AMPL <noreply@ampl.tools>",
      to: recipient,
      subject: msg.subject,
      html: msg.html + "\n" + footer.html,
      text: msg.text + "\n" + footer.text,
      headers: { ...unsubHeaders },
      // Map msg.attachments → ResendPayload.attachments.
      // Only included when attachments are present. Field renames:
      //   SendMessage.type → ResendPayload.content_type
      //   SendMessage.contentId → ResendPayload.content_id (undefined omitted by JSON.stringify)
      // replyTo stays typed-but-unimplemented.
      ...(msg.attachments && msg.attachments.length > 0
        ? {
            attachments: msg.attachments.map((a) => ({
              content: encodeBase64(a.content),
              filename: a.filename,
              content_type: a.type,
              content_id: a.contentId,
            })),
          }
        : {}),
    };

    let resendId: string;
    try {
      ({ id: resendId } = await callResend(this.env.RESEND_API_KEY, payload));
    } catch (error) {
      // Mark the row failed so it does not count toward quota and a later retry
      // with the same idempotency key can re-attempt delivery.
      await db
        .update(schema.sends)
        .set({ status: "failed" })
        .where(eq(schema.sends.id, id));
      logError(error, { action: "email.send.resend" });
      const detail = error instanceof Error ? error.message : "Resend error";
      return { ok: false, reason: "error", detail };
    }

    await db
      .update(schema.sends)
      .set({ status: "sent", resendId })
      .where(eq(schema.sends.id, id));
    return { ok: true, id: resendId };
  }
}
