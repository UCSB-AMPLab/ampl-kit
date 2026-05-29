/**
 * Unsubscribe token signing and verification
 *
 * This file provides HMAC-SHA256 signed tokens for the RFC 8058 one-click
 * unsubscribe flow. Tokens are stateless — they embed the recipient address
 * and a timestamp, signed with `UNSUB_HMAC_SECRET`. The Worker verifies the
 * token on POST `/email/unsubscribe` before adding the address to the
 * suppressions table.
 *
 * `signUnsubToken` is used inside `send()` to build the List-Unsubscribe URL;
 * `verifyUnsubToken` is used by the `handleUnsubscribe` route handler.
 *
 * Token format: `{base64url(address:timestamp)}.{base64url(HMAC-SHA256)}`
 * The separator `.` is safe in a query-string value without percent-encoding.
 *
 * @version v0.1.0
 */

const SEPARATOR = ".";

/** Convert a Uint8Array to a base64url string (no padding). */
function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Decode a base64url string to a Uint8Array. */
function b64urlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Import a raw HMAC-SHA256 key from a UTF-8 string secret. */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Constant-time string comparison (timing-safe). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) result |= aBytes[i] ^ bBytes[i];
  return result === 0;
}

/**
 * Sign an unsubscribe token for the given recipient address.
 *
 * @param address - the recipient email address to embed in the token
 * @param secret  - `UNSUB_HMAC_SECRET` from `this.env`
 * @returns a URL-safe token string suitable for the `?token=` query parameter
 */
export async function signUnsubToken(
  address: string,
  secret: string,
): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(`${address}:${Date.now()}`),
  );
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}${SEPARATOR}${b64url(new Uint8Array(sig))}`;
}

/**
 * Verify an unsubscribe token and return the embedded address.
 *
 * Returns `null` if the token is malformed or the signature does not match.
 * Called inside `handleUnsubscribe` before suppressing the address.
 *
 * @param token  - the `?token=` query value from the unsubscribe URL
 * @param secret - `UNSUB_HMAC_SECRET` from `this.env`
 * @returns the verified recipient address, or `null` on failure
 */
export async function verifyUnsubToken(
  token: string,
  secret: string,
): Promise<string | null> {
  const parts = token.split(SEPARATOR);
  if (parts.length < 2) return null;
  // payload is everything before the last separator; sig is the last part
  const sig = parts[parts.length - 1];
  const payload = parts.slice(0, parts.length - 1).join(SEPARATOR);
  if (!payload || !sig) return null;

  const key = await importHmacKey(secret);
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  if (!timingSafeEqual(sig, b64url(new Uint8Array(expected)))) return null;

  const decoded = new TextDecoder().decode(b64urlDecode(payload));
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;
  return decoded.slice(0, colonIdx);
}
