/**
 * ampl-email Worker entry point
 *
 * This file is the `main` entry for the `ampl-email` Worker declared in
 * `wrangler.email.jsonc`. Its default `WorkerEntrypoint` subclass exposes
 * two surfaces, and a second, named entrypoint serves ampl-auth:
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
 *   3. `AuthEmail.sendAuthEmail(req)` — account-access mail for ampl-auth,
 *      which binds it as `AUTH_EMAIL` with `"entrypoint": "AuthEmail"`. It
 *      renders one of two fixed templates from a checked request, runs the
 *      same pipeline with step (2) ignoring unsubscribe-only suppressions,
 *      and leaves out the unsubscribe header and link in step (5).
 *
 * Security headers (X-Frame-Options, HSTS, X-Content-Type-Options,
 * Referrer-Policy) are stamped on every HTTP response from fetch().
 *
 * @version v0.4.0
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { AuthEmailRequest, SendMessage, SendResult } from "../app/email/types";
import { renderEmailShell } from "../kit/email/shell";
import kitEn from "../kit/locales/en";
import kitEs from "../kit/locales/es";
import { getEmailDb, schema, type EmailDB } from "../app/email/db/client.email";
import { isSuppressed, normalizeEmail } from "../app/email/lib/suppression";
import { parseRecipient } from "../app/email/lib/address";
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

async function runSend(
  env: Env,
  msg: SendMessage,
  opts: { accountAccess: boolean },
): Promise<SendResult> {
  try {
    // (1) Open the email database
    const db = getEmailDb(env);
    const now = Date.now();

    // (1a) Fail closed on a misconfigured environment. RESEND_API_KEY and
    // UNSUB_HMAC_SECRET are provisioned via `wrangler secret put` and are not
    // typed on Env. If either is missing we refuse to deliver — rather than
    // sign the unsubscribe token with an empty HMAC key or call Resend with an
    // empty Bearer — and surface a clean "configuration_error" before any DB
    // write. The underlying crypto already throws on an empty key; this makes
    // the fail-closed behaviour explicit and avoids a wasted Resend call.
    // Mirrors the auth Worker's missing-secret guard.
    const secrets = env as unknown as {
      UNSUB_HMAC_SECRET?: string;
      RESEND_API_KEY?: string;
    };
    if (!secrets.UNSUB_HMAC_SECRET || !secrets.RESEND_API_KEY) {
      logError(new Error("email send secrets missing"), {
        action: "email.send.secrets",
      });
      return { ok: false, reason: "error", detail: "configuration_error" };
    }

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
    // Every later step (suppression, send log, idempotency, quota, the
    // unsubscribe token, and the Resend `to`) uses the bare, normalized
    // address, so `Reader <reader@x>` and `reader@x` are one mailbox. A `to`
    // with CR/LF or more than one address is refused before any write.
    const recipient = typeof recipients[0] === "string" ? parseRecipient(recipients[0]) : null;
    if (!recipient) {
      logError(new Error("invalid recipient rejected"), { action: "email.send" });
      return { ok: false, reason: "error", detail: "invalid_recipient" };
    }

    // (2) Suppression check (global). isSuppressed normalises the address.
    // Account-access mail is not stopped by an unsubscribe, only by a bounce
    // or complaint.
    if (await isSuppressed(db, recipient, { ignoreUnsubscribe: opts.accountAccess })) {
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
    const monthly = Number(env.MONTHLY_QUOTA_CEILING);
    const daily = Number(env.DAILY_QUOTA_CEILING);
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
    return await deliver(env, db, id, recipient, msg, opts);
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
async function deliver(
  env: Env,
  db: EmailDB,
  id: number,
  recipient: string,
  msg: SendMessage,
  opts: { accountAccess: boolean },
): Promise<SendResult> {
  // Secrets are provisioned via `wrangler secret put`; not auto-typed on Env.
  const secrets = env as unknown as {
    UNSUB_HMAC_SECRET: string;
    RESEND_API_KEY: string;
  };
  // Account-access mail carries no unsubscribe link or header: an
  // unsubscribe does not stop it, so offering one would mislead.
  let unsubHeaders: Record<string, string> = {};
  let unsubUrl: string | null = null;
  if (!opts.accountAccess) {
    const unsubToken = await signUnsubToken(
      recipient,
      secrets.UNSUB_HMAC_SECRET,
    );
    unsubUrl = `https://ampl.tools/email/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    unsubHeaders = buildUnsubscribeHeaders(unsubToken);
  }
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
    ({ id: resendId } = await callResend(secrets.RESEND_API_KEY, payload));
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

  // -------------------------------------------------------------------------
  // send() — service-binding RPC for every tool
  //
  // Only the fields of SendMessage are read. Nothing a caller adds can change
  // how suppressions or the unsubscribe envelope apply.
  // -------------------------------------------------------------------------

  async send(msg: SendMessage): Promise<SendResult> {
    return runSend(this.env, msg, { accountAccess: false });
  }
}

// ---------------------------------------------------------------------------
// AuthEmail — account-access mail for ampl-auth only
// ---------------------------------------------------------------------------

const AUTH_KINDS = ["sign-in-link", "github-notice"] as const;
const AUTH_PATHS: Record<AuthEmailRequest["kind"], string> = {
  "sign-in-link": "/auth/email/verify",
  "github-notice": "/auth/login",
};

/** Any whitespace or control character anywhere in a field refuses it. */
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * Returns the request with `to` normalized and `url` replaced by the parsed
 * URL's canonical `href`, or null when any check fails. Raw strings are
 * checked for whitespace and control characters before parsing, because the
 * URL parser silently drops tabs and newlines; only the canonical form is
 * ever rendered.
 */
function canonicalAuthRequest(env: Env, req: unknown): AuthEmailRequest | null {
  if (!req || typeof req !== "object") return null;
  const r0 = req as Record<string, unknown>;
  if (typeof r0.url !== "string" || UNSAFE_CHARS.test(r0.url)) return null;
  if (typeof r0.to !== "string" || UNSAFE_CHARS.test(r0.to)) return null;
  if (!checkAuthFields(env, r0)) return null;
  return {
    to: normalizeEmail(r0.to),
    locale: r0.locale as AuthEmailRequest["locale"],
    kind: r0.kind as AuthEmailRequest["kind"],
    url: new URL(r0.url).href,
    minutes: r0.minutes as number,
  };
}

/**
 * Checks an AuthEmail request field by field. The URL must be https, on the
 * AUTH_APP_URL origin, with no userinfo, at the path the kind requires; a
 * sign-in link carries exactly one parameter, `token`, of 64 lowercase hex
 * characters, and a notice carries none. Used by canonicalAuthRequest.
 */
function checkAuthFields(env: Env, req: Record<string, unknown>): boolean {
  if (!req || typeof req !== "object") return false;
  const r = req as Record<string, unknown>;
  if (typeof r.kind !== "string" || !(AUTH_KINDS as readonly string[]).includes(r.kind)) return false;
  if (r.locale !== "en" && r.locale !== "es") return false;
  if (typeof r.minutes !== "number" || !Number.isInteger(r.minutes) || r.minutes < 1 || r.minutes > 60) {
    return false;
  }
  if (typeof r.to !== "string") return false;
  const to = normalizeEmail(r.to);
  if (to.length > 254 || /[\s\u0000-\u001f\u007f]/.test(to) || to.split("@").length !== 2) return false;
  if (!/^[^@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(to)) return false;
  if (typeof r.url !== "string") return false;
  const authUrl = (env as unknown as { AUTH_APP_URL?: string }).AUTH_APP_URL;
  if (!authUrl) return false;
  let url: URL;
  try {
    url = new URL(r.url);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
  if (url.origin !== new URL(authUrl).origin) return false;
  if (url.pathname !== AUTH_PATHS[r.kind as AuthEmailRequest["kind"]]) return false;
  const params = [...url.searchParams.keys()];
  if (r.kind === "sign-in-link") {
    if (params.length !== 1 || params[0] !== "token") return false;
    if (!/^[0-9a-f]{64}$/.test(url.searchParams.get("token") ?? "")) return false;
  } else if (params.length !== 0) {
    return false;
  }
  return true;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

/** Renders one of the two fixed auth templates from the kit locale strings. */
function renderAuthMessage(req: AuthEmailRequest): SendMessage {
  const c = (req.locale === "es" ? kitEs : kitEn).email.auth;
  const minutes = String(req.minutes);
  const link = req.kind === "sign-in-link";
  const { html, text } = renderEmailShell({
    locale: req.locale,
    preheader: link ? c.linkPreheader : c.githubPreheader,
    heading: link ? c.linkHeading : c.githubHeading,
    blocks: [
      { kind: "text", content: link ? c.linkBody : c.githubBody },
      { kind: "button", label: link ? c.linkButton : c.githubButton, url: req.url },
      { kind: "note", content: link ? fill(c.linkNote, { minutes }) : c.githubNote },
    ],
  });
  return {
    to: normalizeEmail(req.to),
    subject: link ? c.linkSubject : c.githubSubject,
    html,
    text,
    tool: "auth",
    locale: req.locale,
  };
}

/**
 * The entrypoint ampl-auth binds as `AUTH_EMAIL` (`"entrypoint": "AuthEmail"`).
 * It takes no subject or body: only the fields of AuthEmailRequest, checked by
 * validAuthRequest, and renders the message itself. This is the only path on
 * which an unsubscribe-only suppression is skipped and the List-Unsubscribe
 * header and unsubscribe link are left out; bounces and complaints still
 * block delivery, and the quota still applies.
 */
export class AuthEmail extends WorkerEntrypoint<Env> {
  async sendAuthEmail(req: AuthEmailRequest): Promise<SendResult> {
    const canonical = canonicalAuthRequest(this.env, req);
    if (!canonical) {
      logError(new Error("invalid auth email request"), { action: "email.auth.validate" });
      return { ok: false, reason: "error", detail: "invalid_auth_request" };
    }
    return runSend(this.env, renderAuthMessage(canonical), { accountAccess: true });
  }
}
