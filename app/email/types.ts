/**
 * Email service public contract
 *
 * This file defines the `SendMessage` and `SendResult` types that form the
 * `send()` RPC surface between the `ampl-email` Worker and its consumers
 * (Calamus, Scheduling, and future tools). The contract types `attachments`
 * and `replyTo` up front so future consumers need zero breaking changes, even
 * though the Worker does not yet implement rendering or attachment encoding
 * for them.
 *
 * Consumers call `env.EMAIL.send(msg: SendMessage): Promise<SendResult>` via a
 * Cloudflare service binding — the Resend API key never leaves the email Worker.
 *
 * @version v0.2.0
 */

/**
 * The message shape passed to `env.EMAIL.send(msg)`.
 *
 * Required fields:
 * - `to`, `subject`, `html`, `text` — core email content. Callers include the
 *   "[ToolName] " subject prefix; the Worker prepends nothing.
 * - `tool` — identifies the originating tool for the send log; extend the union
 *   as new tools are added.
 *
 * Optional fields:
 * - `idempotencyKey` — when present, the Worker deduplicates on this key via
 *   a D1 UNIQUE constraint; absent means non-idempotent (each call is a new
 *   send).
 * - `locale` — selects the compliance footer language ("en" | "es").
 *
 * Optional fields typed for the future (not yet implemented):
 * - `attachments` — for `.ics` attachments (Scheduling) and similar. The Worker
 *   will re-encode `content` as base64 for the Resend REST API once implemented.
 *   Callers should pass raw binary (`ArrayBuffer`) or raw text (`string`), not
 *   pre-encoded base64.
 * - `replyTo` — for per-tool reply-to addresses.
 */
export interface SendMessage {
  to: string | string[];
  subject: string; // caller includes "[ToolName] " prefix
  html: string;
  text: string;
  tool: "calamus" | "scheduling";

  /** When present, deduplicates on this key. Absent = non-idempotent. */
  idempotencyKey?: string;

  /** Footer/compliance language. Defaults to "en" when absent. */
  locale?: "en" | "es";

  /**
   * Attachments — typed now so consumers need no breaking changes when
   * rendering and encoding are implemented. The Worker currently ignores
   * this field. Pass raw `string` (e.g. `.ics` text) or `ArrayBuffer` (binary);
   * the Worker re-encodes to base64 for the Resend REST API.
   *
   * Not yet implemented.
   */
  attachments?: Array<{
    content: string | ArrayBuffer;
    filename: string;
    type: string;
    disposition?: "attachment" | "inline";
    contentId?: string;
  }>;

  /**
   * Reply-To address (per-tool reply-to).
   *
   * Not yet implemented.
   */
  replyTo?: string;
}

/**
 * The result returned by `env.EMAIL.send(msg)`.
 *
 * On success: `{ ok: true, id: string }` — the Resend message ID.
 * On failure: `{ ok: false, reason, detail? }` — the Worker rejected the send
 *   before calling Resend. Possible reasons:
 *   - `"suppressed"` — the recipient address is on the global suppression list.
 *   - `"quota_exceeded"` — the monthly or daily quota ceiling was reached.
 *   - `"duplicate"` — a send with this `idempotencyKey` was already delivered.
 *   - `"error"` — unexpected error (Resend API failure, etc.); `detail` carries
 *     a safe-to-log message.
 */
export type SendResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: "suppressed" | "quota_exceeded" | "duplicate" | "error";
      detail?: string;
    };
