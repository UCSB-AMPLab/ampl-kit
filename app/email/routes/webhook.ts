/**
 * Resend webhook handler — POST /email/webhook
 *
 * This file handles incoming Resend webhook events. For each event it:
 *   1. Rate-limits by IP (EMAIL_RATE_LIMITER) — returns 429 if exceeded
 *   2. Reads the raw request body as text (never request.json() — the Svix
 *      signature covers the exact original bytes)
 *   3. Verifies the Svix HMAC-SHA256 signature — returns 403 BEFORE any DB write
 *   4. Parses the JSON body and branches on event type:
 *      - email.bounced / email.complained → insert into suppressions
 *        (insert-or-ignore; a repeat bounce for an already-suppressed address
 *        succeeds with 200)
 *      - email.received → forward allowlisted inbound mail (see
 *        handleInboundForward); all other recipients are dropped
 *      - anything else → 200, no-op
 *
 * Inbound forwarding treats every received message as UNTRUSTED external input:
 * it forwards only to destinations configured in the `INBOUND_FORWARDS`
 * secret (forward-map allowlist), never
 * interprets or executes the content, and applies mail-loop guards before
 * relaying. See handleInboundForward for the full guard set.
 *
 * @version v0.4.0
 */

import { verifySvixSignature } from "../lib/svix-verify";
import { getEmailDb } from "../db/client.email";
import { schema } from "../db/client.email";
import { normalizeEmail, recordSuppression } from "../lib/suppression";
import { parseForwardMap, lookupForward, FORWARD_FROM } from "../lib/forward-map";
import {
  callResend,
  getReceivedEmail,
  type ResendPayload,
  type ReceivedEmail,
} from "../lib/resend";
import { logError } from "../../lib/logging.server";

/**
 * Shape of Resend webhook payloads.
 * https://resend.com/docs/webhooks/emails/bounced
 * https://resend.com/docs/webhooks/emails/complained
 * https://resend.com/docs/webhooks/emails/received
 *
 * `to` is a string on bounce/complaint events and a string[] on
 * email.received; `from`/`subject`/`created_at` are present on email.received.
 */
interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data: {
    email_id?: string;
    to?: string | string[];
    from?: string;
    subject?: string;
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

    // 5a. Inbound forwarding — handled inside the signature-verified path.
    //     Forwards mail addressed to an allowlisted recipient (e.g.
    //     hello@ampl.tools) to its mapped destination; drops everything else.
    if (payload.type === "email.received") {
      return await handleInboundForward(payload, env);
    }

    // 5b. Determine suppression reason from event type
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

    // Extract the recipient address (Resend bounce/complaint webhooks use
    // data.to as a string; coerce defensively in case an array slips through).
    const toField = payload.data?.to;
    const address =
      (typeof toField === "string"
        ? toField
        : Array.isArray(toField)
          ? toField[0]
          : undefined) ??
      payload.data?.email ??
      "";
    if (!address) {
      return new Response("Bad Request: missing recipient address", {
        status: 400,
      });
    }

    // 6. Record the suppression. An existing row is raised to this reason
    //    when it ranks higher (complaint > bounce > unsubscribe) and never
    //    lowered, so redelivery is idempotent.
    const db = getEmailDb(env);
    await recordSuppression(db, address, reason, "resend_webhook");

    return new Response("OK", { status: 200 });
  } catch (error) {
    logError(error, { action: "email.webhook" });
    return new Response("Internal Server Error", { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Inbound forwarding
// ---------------------------------------------------------------------------

/**
 * Extract the bare address from a header value, normalized (trim + lowercase).
 * Handles both `"Jane Doe <jane@example.com>"` and a bare `jane@example.com`.
 */
function extractAddress(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return normalizeEmail(m ? m[1] : value);
}

/**
 * Case-insensitive header lookup that tolerates both shapes Resend may return:
 * an object map (`{ "Auto-Submitted": "..." }`) or an array of `{ name, value }`
 * pairs. Returns "" when absent.
 */
function getHeader(headers: ReceivedEmail["headers"], name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (h && typeof h.name === "string" && h.name.toLowerCase() === lower) {
        return typeof h.value === "string" ? h.value : "";
      }
    }
    return "";
  }
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = (headers as Record<string, string>)[k];
      return typeof v === "string" ? v : "";
    }
  }
  return "";
}

/**
 * Mail-loop guard (address-based): is this sender one we must never forward to?
 * True when the sender IS the destination, or is any address on our own
 * sending/receiving infrastructure (`@ampl.tools` / `@send.ampl.tools`).
 * `sender` must already be normalized (see extractAddress).
 */
function isLoopSender(sender: string, destination: string): boolean {
  if (sender === normalizeEmail(destination)) return true;
  if (sender.endsWith("@ampl.tools") || sender.endsWith("@send.ampl.tools")) {
    return true;
  }
  return false;
}

/**
 * Mail-loop guard (header-based): does this message look machine-generated?
 * Skips auto-replies, vacation responders, delivery agents, mailing lists, and
 * bulk mail — forwarding those is the classic way to start a mail loop.
 *
 * - RFC 3834 `Auto-Submitted`: any value other than `no` marks auto-generated
 *   mail. (Genuine human mail omits the header or sends `no`.)
 * - `Precedence: bulk | list | auto_reply` marks bulk / list / auto traffic.
 */
function isAutomated(headers: ReceivedEmail["headers"]): boolean {
  const autoSubmitted = getHeader(headers, "auto-submitted")
    .trim()
    .toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;

  const precedence = getHeader(headers, "precedence").trim().toLowerCase();
  if (
    precedence === "bulk" ||
    precedence === "list" ||
    precedence === "auto_reply"
  ) {
    return true;
  }
  return false;
}

/**
 * Escape the five HTML-significant characters. Applied to untrusted inbound
 * header/subject values before they are interpolated into the forward's HTML
 * note block, so they cannot alter that markup. (The original HTML body is
 * forwarded as-is — it is the message content, like any forwarded email.)
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Handle an `email.received` event: forward mail addressed to an allowlisted
 * recipient to its mapped destination, or drop it.
 *
 * Security model (all "skip" paths return 200 so Resend does not retry; only a
 * genuine misconfiguration — a missing API key — returns 500 to trigger retry):
 *   1. Allowlist: only recipients in the forward map are ever relayed. Anything
 *      else is dropped — the worker is never an open relay.
 *   2. Loop prevention: never forward mail from the destination itself, from
 *      any @ampl.tools / @send.ampl.tools address, from an unattributable
 *      sender, or carrying Auto-Submitted / Precedence:bulk|list|auto_reply.
 *   3. Untrusted content: the inbound body is forwarded as DATA only — never
 *      interpreted or executed. Header/subject values go into JSON payload
 *      fields (no header injection) and are HTML-escaped in the note block.
 *
 * @param payload - the verified email.received webhook payload (metadata)
 * @param env     - Worker env (INBOUND_FORWARDS and RESEND_API_KEY read here)
 */
async function handleInboundForward(
  payload: ResendWebhookPayload,
  env: Env,
): Promise<Response> {
  const data = payload.data ?? {};

  // (1) Parse recipient(s) and resolve the first allowlisted forward target.
  const toRaw = data.to;
  const recipients = Array.isArray(toRaw)
    ? toRaw.filter((r): r is string => typeof r === "string")
    : typeof toRaw === "string" && toRaw
      ? [toRaw]
      : [];

  // The map comes from the `INBOUND_FORWARDS` secret (not auto-typed on Env),
  // parsed once per request. A missing or unparseable secret yields an empty
  // map, so nothing is forwarded; that case is logged once, without addresses.
  const secrets = env as unknown as { INBOUND_FORWARDS?: string };
  const forwardMap = parseForwardMap(secrets.INBOUND_FORWARDS);
  if (Object.keys(forwardMap).length === 0) {
    logError(new Error("INBOUND_FORWARDS missing or unparseable"), {
      action: "email.webhook.forward.map",
    });
    return new Response("OK", { status: 200 });
  }

  let destination: string | null = null;
  for (const r of recipients) {
    const mapped = lookupForward(forwardMap, r);
    if (mapped) {
      destination = mapped;
      break;
    }
  }

  // No recipient is in the allowlist → drop silently (no relay).
  if (!destination) {
    return new Response("OK", { status: 200 });
  }

  // A forward is needed. The API key is required to fetch the inbound body AND
  // to send the forward. Read with the same cast pattern as the webhook secret;
  // fail closed (500) so Resend retries once configuration is fixed, rather
  // than dropping a real message.
  const { RESEND_API_KEY } = env as unknown as { RESEND_API_KEY?: string };
  if (!RESEND_API_KEY) {
    logError(new Error("RESEND_API_KEY missing"), {
      action: "email.webhook.forward.key",
    });
    return new Response("Internal Server Error", { status: 500 });
  }

  // (2a) Cheap loop guard using webhook metadata, before spending an API call.
  const metaSender = extractAddress(
    typeof data.from === "string" ? data.from : "",
  );
  if (metaSender && isLoopSender(metaSender, destination)) {
    return new Response("OK", { status: 200 });
  }

  // Need an email_id to fetch the body. A malformed event with no id is
  // acknowledged (200) — retrying cannot produce a body we can fetch.
  const emailId = typeof data.email_id === "string" ? data.email_id : "";
  if (!emailId) {
    logError(new Error("email.received without email_id"), {
      action: "email.webhook.forward.id",
    });
    return new Response("OK", { status: 200 });
  }

  // Fetch the full inbound body. A transport failure throws to the caller's
  // try/catch → 500 → Resend retries, so a real message is never lost to a
  // transient error.
  const inbound = await getReceivedEmail(RESEND_API_KEY, emailId);

  // Authoritative original sender from the fetched body (fall back to meta).
  const fromRaw =
    (typeof inbound.from === "string" && inbound.from) ||
    (typeof data.from === "string" && data.from) ||
    "";
  const sender = extractAddress(fromRaw);

  // (2b) Loop prevention, authoritative. An unattributable sender (e.g. a null
  // return-path `<>` on a bounce) is not forwarded.
  if (!sender || isLoopSender(sender, destination)) {
    return new Response("OK", { status: 200 });
  }

  // (2c) Loop prevention: machine-generated / bulk / list / auto-reply mail.
  if (isAutomated(inbound.headers)) {
    return new Response("OK", { status: 200 });
  }

  // (3) Build the forward. Inbound values are untrusted DATA: placed into JSON
  // payload fields (no header injection) and HTML-escaped in the note block.
  const origSubject =
    (typeof inbound.subject === "string" && inbound.subject) ||
    (typeof data.subject === "string" && data.subject) ||
    "";
  const date =
    (typeof inbound.date === "string" && inbound.date) ||
    getHeader(inbound.headers, "date") ||
    (typeof payload.created_at === "string" ? payload.created_at : "") ||
    "";
  const origTo = recipients.join(", ");
  const origText = typeof inbound.text === "string" ? inbound.text : "";
  const origHtml = typeof inbound.html === "string" ? inbound.html : "";

  const noteText =
    `---------- Forwarded message ----------\n` +
    `From: ${fromRaw}\n` +
    `To: ${origTo}\n` +
    `Date: ${date}\n` +
    `Subject: ${origSubject}\n\n`;

  const noteHtml =
    `<div style="color:#555;border-bottom:1px solid #ddd;padding-bottom:8px;` +
    `margin-bottom:8px;font-family:sans-serif;font-size:13px;">` +
    `---------- Forwarded message ----------<br>` +
    `From: ${escapeHtml(fromRaw)}<br>` +
    `To: ${escapeHtml(origTo)}<br>` +
    `Date: ${escapeHtml(date)}<br>` +
    `Subject: ${escapeHtml(origSubject)}` +
    `</div>`;

  const forward: ResendPayload = {
    from: FORWARD_FROM,
    to: destination,
    // Replies go to the original sender, not this mailbox.
    reply_to: fromRaw || sender,
    subject: `Fwd: ${origSubject}`,
    text: noteText + origText,
    // Prefer the original HTML; fall back to escaped text so the forward always
    // has an HTML part. No List-Unsubscribe headers — a forward is not bulk mail.
    html: noteHtml + (origHtml || escapeHtml(origText)),
  };

  await callResend(RESEND_API_KEY, forward);
  return new Response("OK", { status: 200 });
}
