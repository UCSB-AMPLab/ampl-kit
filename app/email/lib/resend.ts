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
  /** Custom headers — used for List-Unsubscribe pair (RFC 8058). */
  headers: {
    "List-Unsubscribe": string;
    "List-Unsubscribe-Post": string;
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
