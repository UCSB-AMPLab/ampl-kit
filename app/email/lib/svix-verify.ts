/**
 * Svix webhook signature verification (Web Crypto, no npm dependency)
 *
 * This file verifies the HMAC-SHA256 signature that Resend adds to every
 * webhook delivery. The algorithm: signed content =
 * `${svix-id}.${svix-timestamp}.${rawBody}`; key = base64-decoded portion of
 * the `whsec_`-prefixed secret; expected signature = HMAC-SHA256 of the
 * signed content; compare each space-delimited `v1,<sig>` token in the
 * `svix-signature` header with `timingSafeEqual`. A 300-second timestamp
 * window rejects replays.
 *
 * The `svix` npm package is deliberately NOT imported — manual Web Crypto
 * produces identical output with zero bundle overhead.
 *
 * @version v0.1.0
 */

import { logError } from "../../lib/logging.server";

/**
 * Constant-time string comparison (timing-safe).
 *
 * Compares two strings without short-circuiting on the first mismatch, so an
 * attacker cannot infer signature length or content from response timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) result |= aBytes[i] ^ bBytes[i];
  return result === 0;
}

/**
 * Verify a Svix webhook signature.
 *
 * Reads the `svix-id`, `svix-timestamp`, and `svix-signature` headers from the
 * request, builds the signed content string, computes the expected HMAC-SHA256
 * using the provided secret, and does a timing-safe comparison against each
 * `v1,...` signature in the header.
 *
 * Returns `false` (and logs nothing) for expected failures: bad signature,
 * missing headers, replay outside the 300-second window. Logs and re-throws
 * only for unexpected Web Crypto errors (broken runtime, wrong key format).
 *
 * @param rawBody  - the raw request body as a string (MUST be `await req.text()`
 *                   — never JSON.parse then re-serialize; the signature covers
 *                   the exact bytes Resend sent)
 * @param headers  - the request headers object
 * @param secret   - `RESEND_WEBHOOK_SECRET` from env (a `whsec_...` value)
 * @returns `true` if the signature is valid and the timestamp is within 300s
 */
export async function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  const sigHeader = headers.get("svix-signature") ?? "";

  // Reject if any required header is missing
  if (!id || !timestamp || !sigHeader) return false;

  // Reject replays outside the 5-minute window
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  try {
    // Build the signed content string exactly as Resend does
    const signedContent = `${id}.${timestamp}.${rawBody}`;

    // Decode the base64 key material (strip the "whsec_" prefix)
    const keyBytes = Uint8Array.from(
      atob(secret.replace("whsec_", "")),
      (c) => c.charCodeAt(0),
    );

    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedContent),
    );

    // Base64-encode the computed signature for comparison
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

    // The svix-signature header may contain multiple space-delimited signatures
    // (e.g. "v1,sig1 v1,sig2"). Accept if any matches.
    for (const part of sigHeader.split(" ")) {
      const commaIdx = part.indexOf(",");
      if (commaIdx === -1) continue;
      const version = part.slice(0, commaIdx);
      const value = part.slice(commaIdx + 1);
      if (version === "v1" && timingSafeEqual(value, expected)) return true;
    }

    return false;
  } catch (error) {
    // Only reaches here for unexpected Web Crypto failures (wrong key format,
    // runtime crypto unavailable). A bad signature never throws — it just
    // returns false above.
    logError(error, { action: "email.svix-verify" });
    throw error;
  }
}
