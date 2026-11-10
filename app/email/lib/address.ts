/**
 * Recipient parsing
 *
 * `SendMessage.to` may be a bare address (`reader@x`) or a display form
 * (`Reader <reader@x>`, `"Doe, Jane" <jane@x>`). Suppression lookup, the send
 * log, idempotency and quota all key on the bare, normalized address, so the
 * two forms of one mailbox are treated as one. parseRecipient returns that
 * address, or null when `to` holds a CR or LF, more than one address, or
 * anything that is not a single address.
 *
 * @version v0.4.0
 */

import { normalizeEmail } from "./suppression";

const ADDRESS = /^[^\s@<>",;()\\]+@[^\s@<>",;()\\]+\.[^\s@<>",;()\\]+$/;
const DISPLAY = /^(?:"(?:[^"\\]|\\.)*"|[^"<>,;]*)\s*<([^<>\s]+)>$/;

export function parseRecipient(to: string): string | null {
  if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(to)) return null;
  const trimmed = to.trim();
  const display = trimmed.match(DISPLAY);
  const candidate = display ? display[1] : trimmed;
  return ADDRESS.test(candidate) ? normalizeEmail(candidate) : null;
}
