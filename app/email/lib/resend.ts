/**
 * Resend transport
 *
 * This is the ONLY file in the codebase that reads `RESEND_API_KEY`. It wraps
 * a single POST to the Resend REST API (`https://api.resend.com/emails`). The
 * caller (the `send()` pipeline in `workers/email.ts`) passes the key in; it is
 * never stored, logged, or returned to consumers. Non-2xx responses throw with
 * the response body in the message so the caller can log a safe-to-surface
 * detail string.
 *
 * `attachments` in `ResendPayload` maps `content` to a base64 string as the
 * Resend REST API requires. Callers supply pre-encoded content (or empty
 * attachments).
 *
 * @version v0.2.0
 */

/**
 * The payload shape accepted by the Resend `/emails` endpoint.
 * A subset of the full Resend API.
 */
export interface ResendPayload {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /**
   * Optional Resend `reply_to`. Used by the inbound-forward path to route
   * replies back to the ORIGINAL sender, since the forward's `from` is the
   * kit-owned verified sender, not the person who wrote the message.
   */
  reply_to?: string | string[];
  /**
   * Custom headers. The `send()` pipeline always supplies the RFC 8058
   * List-Unsubscribe pair here; the inbound-forward path omits `headers`
   * entirely, because a forwarded transactional message must NOT carry
   * marketing unsubscribe headers. Optional so a forward can leave it unset.
   */
  headers?: {
    [key: string]: string;
  };
  /** Optional attachments. */
  attachments?: Array<{
    content: string; // base64-encoded for the Resend REST API
    filename: string;
    content_type: string;
    content_id?: string;
  }>;
}

/**
 * A received (inbound) email as returned by the Resend Receiving API
 * (`GET /emails/receiving/{id}`). Webhooks carry metadata only; the body,
 * headers, and date are fetched here. Fields are optional/defensive because
 * this is untrusted external content and the API shape may evolve.
 */
export interface ReceivedEmail {
  id?: string;
  /** Original sender, e.g. `"Jane <jane@example.com>"` or a bare address. */
  from?: string;
  /** Original recipient list. */
  to?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  /** Date the message was sent, when the API surfaces it as a top-level field. */
  date?: string;
  /**
   * Email headers. Resend may return either an object map or an array of
   * `{ name, value }` pairs; consumers must handle both (see `getHeader`).
   */
  headers?: Record<string, string> | Array<{ name: string; value: string }>;
  [key: string]: unknown;
}

/**
 * Call the Resend REST API to send one email.
 *
 * This is the sole place `RESEND_API_KEY` is used. Throws on non-2xx with
 * the response body in the message — callers should catch, log with
 * `logError({ action: "email.send" })`, and surface a safe `detail` string.
 *
 * @param apiKey - `RESEND_API_KEY` from `this.env` (never stored or returned)
 * @param payload - the structured email payload
 * @returns Resend's `{ id }` object on success
 */
export async function callResend(
  apiKey: string,
  payload: ResendPayload,
): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) {
    throw new Error("Resend: missing id in response");
  }
  return { id: data.id };
}

/**
 * Fetch the full body of a received (inbound) email from the Resend Receiving
 * API. The `email.received` webhook delivers metadata only; the HTML/text body
 * and headers must be retrieved separately via `GET /emails/receiving/{id}`.
 *
 * Like `callResend`, this takes the API key as a parameter (read by the caller
 * from `env`) and never stores or logs it. Throws on non-2xx with the response
 * body in the message so the caller can log a safe detail string.
 *
 * @param apiKey  - `RESEND_API_KEY` from env (never stored or returned)
 * @param emailId - the `data.email_id` from the `email.received` webhook
 * @returns the received email's body, headers, and metadata
 */
export async function getReceivedEmail(
  apiKey: string,
  emailId: string,
): Promise<ReceivedEmail> {
  const res = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend receiving error ${res.status}: ${body}`);
  }

  return (await res.json()) as ReceivedEmail;
}
