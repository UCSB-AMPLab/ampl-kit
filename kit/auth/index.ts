/**
 * Auth session-validation helper
 *
 * This module is how any AMPL tool answers one question — "is whoever sent this
 * request a signed-in user, and if so, who?" — without owning the login flow
 * itself. It reads the session cookie off an incoming request, looks it up in
 * the shared auth database, and hands back the authenticated user or `null`.
 * It deliberately only ever reads: the single `SELECT` it issues never updates
 * or inserts anything, so a consumer tool can bind the auth database read-only
 * and trust that calling it cannot change session state. The work of refreshing
 * or "rolling" a session is a write that lives elsewhere, with the app that
 * holds a write-capable connection. Alongside the validator, the module exposes
 * three small URL helpers — one that sanitises a `return_to` value to block
 * open-redirect attacks, one that builds an absolute login-redirect URL, and
 * one that builds an absolute logout URL — plus a re-export of the database
 * contract types so a consumer gets everything from a single import. The
 * cookie-reading helpers stay private because consumers only ever need to
 * validate cookies, never construct them.
 *
 * @version v0.1.0
 */

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { users, sessions } from "./schema";
import type { AuthDbSchema, AuthenticatedUser } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Re-export the contract types so consumers get everything from one import
// ─────────────────────────────────────────────────────────────────────────────
export type { AuthenticatedUser, AuthDbSchema } from "./schema";
// Also re-export the schema tables so consumers can build their typed db:
//   import { users, sessions, type AuthDbSchema } from "@ampl/kit/auth"
export { users, sessions } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Cookie-name resolution (module-private — lifted verbatim from
// app/sessions.server.ts lines 61-121; same logic, same names)
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_NAME_SECURE = "__Host-ampl_session";
const COOKIE_NAME_DEV = "ampl_session";

function getCookieName(isSecureOrigin: boolean): string {
  return isSecureOrigin ? COOKIE_NAME_SECURE : COOKIE_NAME_DEV;
}

/** Determines whether the request originated on a secure (HTTPS) origin. */
function isSecureRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** SHA-256(rawCookieValue) → 64-char lowercase hex; the session-row PK. */
function hashCookieValue(raw: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(raw)));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reads a single cookie value out of a `Cookie:` header by name. */
function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const re = new RegExp(`(?:^|;)\\s*${escapeRegExp(name)}=([^;]+)`);
  const match = cookieHeader.match(re);
  return match ? match[1].trim() : null;
}

/** Validates that the raw cookie value looks like a 64-char lowercase hex token. */
function isValidRawCookieValue(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the session cookie on the request and returns the authenticated
 * user, or null if the session is missing, malformed, not found, or expired.
 *
 * CRITICAL: this function is strictly read-only. It issues a
 * single SELECT — no UPDATE, no INSERT, no rollSessionIfIdle. Consumer tools
 * that bind AUTH_DB read-only cannot roll sessions; the 30-day absolute
 * lifetime applies. See kit/README.md §AUTH_DB contract for the non-refresh note.
 *
 * Dev parity: on HTTP origins the prefix-less `ampl_session` cookie name
 * is used so dev is testable without Secure cookies.
 */
export async function validateSession(
  db: DrizzleD1Database<AuthDbSchema>,
  request: Request,
): Promise<AuthenticatedUser | null> {
  const isSecure = isSecureRequest(request);
  const cookieName = getCookieName(isSecure);
  const rawCookieValue = getCookieValue(request.headers.get("cookie"), cookieName);
  if (!rawCookieValue || !isValidRawCookieValue(rawCookieValue)) {
    return null;
  }
  const sessionId = hashCookieValue(rawCookieValue);
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row) return null;
  if (row.session.expiresAt <= Date.now()) return null;
  return {
    id: row.user.id,
    githubId: row.user.githubId,
    email: row.user.email,
    handle: row.user.handle,
    name: row.user.name,
    avatarUrl: row.user.avatarUrl,
  };
}

/**
 * Validates a `return_to` value from a query string or cookie. Returns a safe
 * same-origin path, or "/" if the input is missing, malformed, or suspicious.
 *
 *
 * Rejects:
 *   - null / empty
 *   - values not starting with "/"
 *   - protocol-relative "//evil"
 *   - backslash (handles `\\evil` and `/path\\evil`)
 *   - embedded schemes (javascript:, http://, etc.) via URL parser
 *
 * NOTE: returns the full apex pathname (e.g. /paleography/x)
 * — NOT basename-stripped. The callback's absolute-URL redirect handles
 * routing without double-prefix.
 */
export function safeReturnTo(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  try {
    const u = new URL(value, "http://example.invalid");
    if (u.origin !== "http://example.invalid") return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}

/**
 * Builds an absolute login redirect URL that bypasses React Router v7's basename
 * prepend. Consumer tools call this to redirect unauthenticated users.
 *
 * Example:
 *   buildLoginRedirect("/paleography", "https://ampl.tools")
 *   // → "https://ampl.tools/auth/login?return_to=%2Fpaleography"
 *
 * The `returnTo` value should already be validated by `safeReturnTo`.
 */
export function buildLoginRedirect(
  returnTo: string,
  origin: string,
  authBasename: string = "/auth",
): string {
  return new URL(
    authBasename + "/login?return_to=" + encodeURIComponent(returnTo),
    origin,
  ).toString();
}

/**
 * Builds an absolute logout URL that bypasses React Router v7's basename
 * prepend. Consumer tools call this to redirect users to the apex logout
 * endpoint, optionally with a `return_to` path so the user lands back on the
 * right page after the session is cleared.
 *
 * Mirrors `buildLoginRedirect` exactly — same argument order, same default
 * basename, same absolute URL output via `new URL(...)`.
 *
 * Example:
 *   buildLogoutHref("/paleography", "https://ampl.tools")
 *   // → "https://ampl.tools/auth/logout?return_to=%2Fpaleography"
 *
 * The `returnTo` value should already be validated by `safeReturnTo`.
 */
export function buildLogoutHref(
  returnTo: string,
  origin: string,
  authBasename: string = "/auth",
): string {
  return new URL(
    authBasename + "/logout?return_to=" + encodeURIComponent(returnTo),
    origin,
  ).toString();
}
