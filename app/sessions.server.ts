/**
 * Session primitives
 *
 * This module deals with the lifecycle of a signed-in session, stored as a row
 * in the D1 database and referenced by a cookie in the user's browser. When
 * someone signs in, it mints 32 random bytes, stores only the SHA-256 hash of
 * them as the session's primary key — so a database leak can never reveal a
 * usable token — and hands back the raw value for the cookie. On every
 * subsequent request it reads that cookie, re-hashes it, looks up the matching
 * row, and resolves it to the authenticated user; expired rows are treated as
 * absent. It rolls a session's expiry forward at most once a day to keep the
 * "30 days from last activity" window alive without hammering the database, and
 * it builds the exact `Set-Cookie` headers that create and clear the session —
 * always at `Path=/` so the cookie is shared across every tool on the
 * `ampl.tools` apex, which is what makes single sign-on work.
 *
 * Design notes:
 *   1. Cookie names: `__Host-ampl_session` / `ampl_session`.
 *   2. Path=/ hard-coded in both header builders (SSO + `__Host-` prefix requirement).
 *      The `__Host-` prefix forces `Path=/`, broadcasting the session cookie to
 *      every tool on the shared `ampl.tools` apex — this IS the SSO mechanism.
 *      Using a basename-scoped path would silently break SSO.
 *   3. AuthenticatedUser maps GitHub columns: githubId, handle, name, avatarUrl.
 *
 * Token shape:
 *   - 32 random bytes (256 bits) from `crypto.getRandomValues` per session.
 *   - `rawCookieValue` is the lowercase hex of those bytes (64 chars). This is
 *     what the browser stores in the cookie.
 *   - The session row PK is `encodeHexLowerCase(sha256(rawCookieValue))` — the
 *     hash IS the identifier. A DB leak reveals which sessions exist but not
 *     enough to forge them.
 *
 * Cookie name + path:
 *   - On HTTPS origins: `__Host-ampl_session` with Secure, HttpOnly, SameSite=Lax,
 *     Path=/, Max-Age=2592000. The `__Host-` prefix enforces Path=/ in the browser.
 *   - On HTTP origins (wrangler dev on localhost): `ampl_session`. Browsers
 *     silently reject `__Host-` cookies on HTTP, so dev would be un-debuggable.
 *     Dev-strip keeps the auth flow testable without Secure.
 *
 * Lifecycle:
 *   - Sessions live for 30 days from creation; rolling-idle refresh extends
 *     `expires_at` by 30d on every "active day" the user touches a request.
 *   - The 24-hour throttle on `last_seen_at` writes bounds row-update churn
 *     to ~1 per active session per day — well within D1 free-tier limits.
 *   - No mid-session token rotation; sign-out is device-only (DELETE current row).
 *   - Expired rows are inert (every read filters `expires_at > now`).
 *
 * @version v0.1.0
 */

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sessions, users } from "./db/schema";
import * as schema from "./db/schema";
import type { AuthenticatedUser } from "./context";
import { logError } from "./lib/logging.server";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** 30 days in milliseconds — full session lifetime. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** 24 hours in milliseconds — throttle for `last_seen_at` rolling refresh. */
export const IDLE_REFRESH_THROTTLE_MS = 24 * 60 * 60 * 1000;

/**
 * Cookie name on HTTPS origins. `__Host-` prefix enforces Path=/, Secure, and
 * no Domain= — broadcasting the cookie to every tool on the ampl.tools apex (SSO).
 */
export const COOKIE_NAME_SECURE = "__Host-ampl_session";

/** Cookie name on HTTP origins (dev-strip — browsers reject __Host- on HTTP). */
export const COOKIE_NAME_DEV = "ampl_session";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Db = DrizzleD1Database<typeof schema>;
type SessionRow = typeof sessions.$inferSelect;

export interface CreatedSession {
  sessionId: string;
  rawCookieValue: string;
  expiresAt: number;
}

export interface ResolvedSession {
  session: SessionRow;
  user: AuthenticatedUser;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves the cookie name to use for a given request protocol. */
export function getCookieName(isSecureOrigin: boolean): string {
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

/** Reads a single cookie value out of a `Cookie:` header by name. */
export function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const re = new RegExp(`(?:^|;)\\s*${escapeRegExp(name)}=([^;]+)`);
  const match = cookieHeader.match(re);
  return match ? match[1].trim() : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Validates that the raw cookie value looks like a 64-char lowercase hex token. */
function isValidRawCookieValue(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a fresh session for the given user and returns the cookie value to
 * set on the response. Caller is responsible for emitting the Set-Cookie
 * header via `sessionCookieHeader`.
 */
export async function createSessionForUser(
  db: Db,
  userId: number,
): Promise<CreatedSession> {
  try {
    const rawBytes = crypto.getRandomValues(new Uint8Array(32));
    const rawCookieValue = encodeHexLowerCase(rawBytes);
    const sessionId = hashCookieValue(rawCookieValue);
    const now = Date.now();
    const expiresAt = now + SESSION_DURATION_MS;
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      createdAt: now,
      expiresAt,
      lastSeenAt: null,
    });
    return { sessionId, rawCookieValue, expiresAt };
  } catch (error) {
    logError(error, { action: "session.create", userId: String(userId) });
    throw error;
  }
}

/**
 * Resolves the session cookie on the request to a (session, user) pair.
 * Returns null when:
 *   - The cookie header is missing.
 *   - The cookie value is malformed (not 64 hex chars).
 *   - The hashed value doesn't match any session row.
 *   - The matched session row has `expires_at <= now`.
 */
export async function getSessionFromRequest(
  db: Db,
  request: Request,
): Promise<ResolvedSession | null> {
  try {
    const isSecure = isSecureRequest(request);
    const cookieName = getCookieName(isSecure);
    const cookieHeader = request.headers.get("cookie");
    const rawCookieValue = getCookieValue(cookieHeader, cookieName);
    if (!rawCookieValue || !isValidRawCookieValue(rawCookieValue)) {
      return null;
    }
    const sessionId = hashCookieValue(rawCookieValue);
    const row = await db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId))
      .get();
    if (!row) {
      return null;
    }
    if (row.session.expiresAt <= Date.now()) {
      return null;
    }
    const authenticatedUser: AuthenticatedUser = {
      id: row.user.id,
      githubId: row.user.githubId,
      email: row.user.email,
      handle: row.user.handle,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl,
    };
    return { session: row.session, user: authenticatedUser };
  } catch (error) {
    logError(error, { action: "session.resolve" });
    throw error;
  }
}

/**
 * Refreshes `last_seen_at` + `expires_at` if the row hasn't been touched
 * within the throttle window (`IDLE_REFRESH_THROTTLE_MS` = 24 hours).
 * No-op when the throttle has not elapsed — bounds DB churn to ~1 row write
 * per active session per day.
 */
export async function rollSessionIfIdle(
  db: Db,
  session: SessionRow,
): Promise<void> {
  try {
    const now = Date.now();
    const last = session.lastSeenAt;
    const shouldRoll = last === null || now - last >= IDLE_REFRESH_THROTTLE_MS;
    if (!shouldRoll) return;
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: now + SESSION_DURATION_MS })
      .where(eq(sessions.id, session.id));
  } catch (error) {
    logError(error, { action: "session.roll" });
    throw error;
  }
}

/**
 * Deletes the session row identified by the cookie hash. Used by `/auth/logout`
 * (device-only sign-out scope).
 */
export async function destroySession(db: Db, sessionId: string): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch (error) {
    logError(error, { action: "session.destroy" });
    throw error;
  }
}

/**
 * Builds the `Set-Cookie` header value for a freshly-created session.
 *
 * On HTTPS origins emits `__Host-ampl_session` with `Secure` and `Path=/` —
 * the `__Host-` prefix is browser-enforced to require both, and `Path=/`
 * broadcasts the cookie to every tool on the `ampl.tools` apex (SSO).
 *
 * On HTTP origins drops the prefix and `Secure` so dev cookies survive
 * `wrangler dev` on localhost. Path=/ is kept (required for `__Host-` on HTTPS
 * and consistent for the dev-strip variant).
 *
 * IMPORTANT: `Path` is the literal "/" — never a basename-scoped path (which
 * would produce Path=/auth and silently break SSO).
 */
export function sessionCookieHeader(rawCookieValue: string, isSecureOrigin: boolean): string {
  const name = getCookieName(isSecureOrigin);
  const maxAge = SESSION_DURATION_MS / 1000;
  const attrs = [
    `${name}=${rawCookieValue}`,
    isSecureOrigin ? "Secure" : null,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ].filter((s): s is string => s !== null);
  return attrs.join("; ");
}

/**
 * Builds the `Set-Cookie` header value to clear the session cookie (logout).
 * Mirrors `sessionCookieHeader` attribute-for-attribute except `Max-Age=0`
 * and an empty value, so the browser drops the cookie immediately.
 */
export function clearSessionCookieHeader(isSecureOrigin: boolean): string {
  const name = getCookieName(isSecureOrigin);
  const attrs = [
    `${name}=`,
    isSecureOrigin ? "Secure" : null,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ].filter((s): s is string => s !== null);
  return attrs.join("; ");
}
