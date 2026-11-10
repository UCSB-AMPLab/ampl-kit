/**
 * Inbound forward map
 *
 * Configuration for the inbound email-forwarding feature. Resend routes every
 * message addressed to a verified `ampl.tools` receiving address to the single
 * `email.received` webhook; the forward map decides which of those recipients
 * are forwarded onward, and to whom.
 *
 * The map is read from the `INBOUND_FORWARDS` Worker secret: a JSON object
 * whose keys are recipient addresses and whose values are destination
 * addresses, for example `{"hello@ampl.tools":"someone@example.org"}`. The
 * secret is set with `wrangler secret put INBOUND_FORWARDS --config
 * wrangler.email.jsonc`, so the destinations are not part of the source code.
 *
 * Keys are stored in the form produced by `normalizeEmail` (trimmed and
 * lowercased). A recipient absent from the map is dropped silently, and the
 * webhook never relays mail to an address that is not a configured
 * destination. This allowlist keeps the Worker from acting as an open relay:
 * adding a forward is a deliberate change to the secret, never driven by the
 * contents of an inbound email. When the secret is missing or cannot be
 * parsed, the map is empty and nothing is forwarded.
 *
 * @version v0.4.0
 */

import { normalizeEmail } from "./suppression";

/**
 * The kit-owned verified sender used as the `From` on every forwarded message.
 *
 * This reuses the exact verified identity the `send()` pipeline already uses
 * (`workers/email.ts`): the `ampl.tools` domain is verified for sending, so a
 * forward From this address passes SPF/DKIM/DMARC. The original sender is
 * preserved on the forward's `Reply-To` (set in the webhook handler) so replies
 * reach the real person, not this mailbox.
 */
export const FORWARD_FROM = "AMPL <noreply@ampl.tools>";

/** Minimal shape check for an email address: no whitespace, one `@`, a dotted domain. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse the raw `INBOUND_FORWARDS` secret into a normalized forward map.
 *
 * Returns an empty map when the value is undefined, empty, not valid JSON, or
 * not a JSON object. Entries are kept only when both key and value are strings
 * that look like email addresses; keys are normalized with `normalizeEmail`
 * and values are trimmed.
 *
 * @param raw - the secret's string value, or `undefined` when it is not set
 * @returns lowercased recipient → destination address
 */
export function parseForwardMap(
  raw: string | undefined,
): Readonly<Record<string, string>> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const recipient = normalizeEmail(key);
    const destination = value.trim();
    if (!EMAIL_SHAPE.test(recipient) || !EMAIL_SHAPE.test(destination)) continue;
    map[recipient] = destination;
  }
  return map;
}

/**
 * Resolve the forward destination for a single recipient address, or `null` if
 * the recipient is not in the map. The address is normalized (trim +
 * lowercase) before lookup, matching the keys produced by `parseForwardMap`.
 *
 * @param map       - the parsed forward map
 * @param recipient - a recipient address from the inbound webhook `data.to`
 * @returns the mapped destination address, or `null` to drop (no relay)
 */
export function lookupForward(
  map: Readonly<Record<string, string>>,
  recipient: string,
): string | null {
  return Object.prototype.hasOwnProperty.call(map, normalizeEmail(recipient))
    ? map[normalizeEmail(recipient)]
    : null;
}
