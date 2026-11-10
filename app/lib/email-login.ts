/**
 * Email sign-in constants shared by the server and the browser
 *
 * The sign-in pages show the link lifetime, so it lives here rather than in
 * the server-only module, which must never reach the browser bundle.
 *
 * @version v0.4.0
 */

/** A sign-in link works for 15 minutes. */
export const TOKEN_TTL_MS = 15 * 60 * 1000;

/** The same lifetime in whole minutes, for display. */
export const TOKEN_TTL_MINUTES = TOKEN_TTL_MS / 60000;
