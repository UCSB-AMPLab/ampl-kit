/**
 * Email sign-in links
 *
 * This module holds everything behind "email me a sign-in link" except the
 * routes themselves: reading the feature configuration, normalizing and
 * checking an address against the domain allow-list, the same-origin check
 * the two POST routes apply, Turnstile verification, issuing and using
 * tokens, finding or creating the email-only account, completing a sign-in,
 * and asking the email Worker's AuthEmail entrypoint for one of its two fixed
 * messages (the sign-in link, or the notice sent instead when the address
 * belongs to an account its owner signs in to with GitHub).
 *
 * Token shape mirrors sessions: 32 random bytes, sent as 64 lowercase hex
 * characters, stored only as the SHA-256 hex of that string. A token is
 * usable once, for 15 minutes, and requesting a new link for the same address
 * marks the older unused ones consumed. Issuing is one batch: an INSERT
 * guarded by the hourly count for the address's limit key, then an UPDATE of
 * the older rows that applies only when the INSERT did. Using a token is one
 * UPDATE ... RETURNING guarded by `consumed_at IS NULL AND expires_at > now`,
 * with `now` read at that moment, so two concurrent POSTs cannot both succeed
 * and a link that expires or is replaced mid-request is refused.
 *
 * The per-address rate limit and the hourly cap count by a limit key: the
 * address with any `+tag` removed from the local part, so `person+1@` and
 * `person+2@` share one limit. The sign-in identity stays the full address.
 *
 * Nothing here logs a token, a link, or an address.
 *
 * @version v0.4.0
 */

import { eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { safeReturnTo } from "@ampl/kit/auth";
import type { SendResult } from "@ampl/kit/email";
import * as schema from "~/db/schema";
import { users } from "~/db/schema";
import type { AuthEmailRequest } from "~/email/types";
import { mintSessionToken, type CreatedSession } from "~/sessions.server";
import { BASENAME, withBase } from "~/lib/paths";
import { logError } from "~/lib/logging.server";
import { TOKEN_TTL_MS, TOKEN_TTL_MINUTES } from "~/lib/email-login";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export { TOKEN_TTL_MS } from "~/lib/email-login";

/** At most this many links (or GitHub notices) per address per hour. */
export const HOURLY_TOKEN_CAP = 3;

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_DOMAINS = "ucsb.edu";
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The action the sign-in widget is rendered with and siteverify must echo. */
export const TURNSTILE_ACTION = "email-login";

/** Cloudflare's documented test site keys: 1x…, 2x… and 3x… followed by zeros. */
const TURNSTILE_TEST_KEY = /^[123]x0{10,}/;

type Db = DrizzleD1Database<typeof schema>;
type UserRow = typeof users.$inferSelect;
export type Locale = "en" | "es";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailLoginConfig {
  enabled: boolean;
  domains: string[];
  turnstileSiteKey: string;
  turnstileSecret: string;
  appUrl: string;
  appOrigin: string;
}

/**
 * Reads the email sign-in vars. They are read as plain strings because the
 * generated `Env` types them as the literal values in wrangler.jsonc.
 * `TURNSTILE_SECRET_KEY` is a secret set with `wrangler secret put`.
 */
export function emailLoginConfig(env: Env): EmailLoginConfig {
  const e = env as unknown as Record<string, string | undefined>;
  const appUrl = e.APP_URL ?? "";
  return {
    enabled: e.EMAIL_LOGIN_ENABLED === "true",
    domains: parseAllowedDomains(e.EMAIL_LOGIN_DOMAINS),
    turnstileSiteKey: e.TURNSTILE_SITE_KEY ?? "",
    turnstileSecret: e.TURNSTILE_SECRET_KEY ?? "",
    appUrl,
    appOrigin: new URL(appUrl).origin,
  };
}

/** Comma-separated domains, trimmed and lower-cased; unset means "ucsb.edu". */
export function parseAllowedDomains(value: string | undefined): string[] {
  return (value ?? DEFAULT_DOMAINS)
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/**
 * Builds an absolute URL inside this app from the origin of APP_URL, never
 * from the request. Only the origin is used, because the production APP_URL
 * carries the /auth path and the staging one does not.
 */
export function appUrl(appUrlVar: string, path: string): string {
  return new URL(withBase(path), new URL(appUrlVar).origin).toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Addresses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips spaces, tabs, line feeds and carriage returns from both ends and
 * lower-cases ASCII letters. Every check, count, and lookup uses this form.
 *
 * It matches the SQL in migration 0002 and the production pre-check exactly:
 *   lower(trim(email, char(32) || char(9) || char(10) || char(13)))
 * SQLite's lower() changes only ASCII letters, so this does too. Any other
 * whitespace is left in place, and isPlausibleEmail then rejects it.
 */
export function normalizeEmail(raw: string): string {
  return raw
    .replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The key the per-address rate limit and the hourly cap count by: the
 * normalized address with any `+tag` removed from the local part. Dots in the
 * local part are deliberately not folded: dot-insensitivity is a Gmail
 * convention, and on organizational domains such as ucsb.edu `a.b@` and `ab@`
 * can be different mailboxes.
 */
export function limitKey(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  const local = email.slice(0, at);
  const plus = local.indexOf("+");
  return `${plus < 0 ? local : local.slice(0, plus)}${email.slice(at)}`;
}

/**
 * A deliberately plain syntax check on a normalized address: one "@", a
 * non-empty local part, a dotted domain, no whitespace or control characters,
 * at most 254 characters. Delivery is the real test.
 */
export function isPlausibleEmail(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return false;
  return true;
}

/** Exact domain match against the allow-list; subdomains are not included. */
export function isAllowedDomain(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return domains.includes(email.slice(at + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Request checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accepts a POST only when the browser says it came from this origin.
 *
 *   - `Sec-Fetch-Site`, when present, must be `same-origin`.
 *   - `Origin`, when present and not `null`, must equal the APP_URL origin.
 *   - Without `Sec-Fetch-Site`, a real `Origin` is required.
 *
 * `Origin: null` is accepted only alongside `Sec-Fetch-Site: same-origin`:
 * these pages are served with `Referrer-Policy: no-referrer`, under which
 * browsers send `Origin: null` on same-origin form POSTs.
 */
export function isSameOriginPost(request: Request, appOrigin: string): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if (site !== null && site !== "same-origin") return false;
  if (origin !== null && origin !== "null" && origin !== appOrigin) return false;
  if (site === null && (origin === null || origin === "null")) return false;
  return true;
}

/**
 * What siteverify must report for a token to count: the hostname the widget
 * ran on and the action it was rendered with. Null skips both checks, which
 * is the case for Cloudflare's test site keys because they answer with a
 * placeholder hostname.
 */
export function turnstileExpectation(
  config: Pick<EmailLoginConfig, "turnstileSiteKey" | "appUrl">,
): { hostname: string; action: string } | null {
  if (TURNSTILE_TEST_KEY.test(config.turnstileSiteKey)) return null;
  return { hostname: new URL(config.appUrl).hostname, action: TURNSTILE_ACTION };
}

/**
 * Verifies a Turnstile response server-side. Any failure counts as a fail.
 * When `expected` is given, the token must also have been issued for that
 * hostname and action.
 */
export async function verifyTurnstile(
  secret: string,
  response: string,
  ip: string | null,
  expected: { hostname: string; action: string } | null,
): Promise<boolean> {
  if (!secret || !response || response.length > 2048) return false;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response, ...(ip ? { remoteip: ip } : {}) }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      success?: unknown;
      hostname?: unknown;
      action?: unknown;
    };
    if (data.success !== true) return false;
    if (!expected) return true;
    return data.hostname === expected.hostname && data.action === expected.action;
  } catch (error) {
    logError(error, { action: "email.turnstile" });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────

export function sha256Hex(value: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(value)));
}

/** A raw token is exactly 64 lowercase hex characters. */
export function isRawToken(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export interface TokenRow {
  email: string;
  return_to: string;
  locale: string;
}

/**
 * Inserts a token row when the address's limit key has fewer than
 * HOURLY_TOKEN_CAP rows created in the last hour, and in the same batch marks
 * the address's older unused tokens consumed. Returns false when the cap
 * applied and nothing changed. `consumed` inserts a row that is already used:
 * it counts toward the cap but can never sign anyone in (used for the GitHub
 * notice).
 */
async function insertTokenRow(
  d1: D1Database,
  row: { id: string; email: string; returnTo: string; locale: Locale; consumed: boolean },
  now: number,
): Promise<boolean> {
  const [insert] = await d1.batch([
    d1
      .prepare(
        `INSERT INTO email_login_tokens (id, email, limit_key, return_to, locale, created_at, expires_at, consumed_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE (SELECT COUNT(*) FROM email_login_tokens WHERE limit_key = ?3 AND created_at > ?9) < ?10`,
      )
      .bind(
        row.id,
        row.email,
        limitKey(row.email),
        row.returnTo,
        row.locale,
        now,
        now + TOKEN_TTL_MS,
        row.consumed ? now : null,
        now - HOUR_MS,
        HOURLY_TOKEN_CAP,
      ),
    // Superseded tokens are marked consumed, not just shortened, so whether
    // they still work never depends on which clock reads later.
    d1
      .prepare(
        `UPDATE email_login_tokens SET consumed_at = ?3
         WHERE email = ?2 AND id <> ?1 AND consumed_at IS NULL
           AND EXISTS (SELECT 1 FROM email_login_tokens WHERE id = ?1)`,
      )
      .bind(row.id, row.email, now),
  ]);
  return (insert.meta.changes ?? 0) > 0;
}

/** Issues a sign-in token; returns the raw value, or null when capped. */
export async function issueToken(
  d1: D1Database,
  input: { email: string; returnTo: string; locale: Locale },
): Promise<string | null> {
  const raw = encodeHexLowerCase(crypto.getRandomValues(new Uint8Array(32)));
  const ok = await insertTokenRow(
    d1,
    { id: sha256Hex(raw), ...input, consumed: false },
    Date.now(),
  );
  return ok ? raw : null;
}

/** Looks up a usable token without using it. Reads the clock when it runs. */
export async function peekToken(d1: D1Database, raw: string): Promise<TokenRow | null> {
  if (!isRawToken(raw)) return null;
  return d1
    .prepare(
      `SELECT email, return_to, locale FROM email_login_tokens
       WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
    )
    .bind(sha256Hex(raw), Date.now())
    .first<TokenRow>();
}

/**
 * Uses a token. At most one caller ever gets a row back for a given token.
 * The clock is read here, at the moment of use, never earlier in the request.
 */
export async function consumeToken(d1: D1Database, raw: string): Promise<TokenRow | null> {
  if (!isRawToken(raw)) return null;
  return d1
    .prepare(
      `UPDATE email_login_tokens SET consumed_at = ?1
       WHERE id = ?2 AND consumed_at IS NULL AND expires_at > ?1
       RETURNING email, return_to, locale`,
    )
    .bind(Date.now(), sha256Hex(raw))
    .first<TokenRow>();
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.email, email)).get();
}

/**
 * Cleans a display name: Unicode NFC, control characters removed, runs of
 * whitespace collapsed, trimmed, at most 80 characters. Returns null when
 * nothing is left.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join("").trim();
}

/**
 * Creates an email-only account (github_id NULL) and gives it the handle
 * `~<id>`. The handle needs the id, so the row goes in with a unique
 * placeholder handle and is renamed in the same batch; "~" never appears in a
 * GitHub login, so neither form can collide with one. An existing row for the
 * address (a concurrent sign-in) is left alone and returned.
 */
export async function createEmailUser(
  d1: D1Database,
  db: Db,
  email: string,
  name: string | null,
  now: number,
): Promise<UserRow> {
  const placeholder = `~new-${encodeHexLowerCase(crypto.getRandomValues(new Uint8Array(8)))}`;
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO users (github_id, email, handle, name, avatar_url, created_at, last_seen_at)
         VALUES (NULL, ?1, ?2, ?3, NULL, ?4, ?4)
         ON CONFLICT (email) DO NOTHING`,
      )
      .bind(email, placeholder, name, now),
    d1.prepare(`UPDATE users SET handle = '~' || id WHERE handle = ?1`).bind(placeholder),
  ]);
  const user = await findUserByEmail(db, email);
  if (!user) throw new Error("email user insert returned no row");
  return user;
}

/**
 * Records the sign-in and creates the session in one batch, both conditional
 * on `github_id IS NULL` in SQL. A GitHub callback that links the row at any
 * point before this batch makes both statements match nothing, and no session
 * exists. Returns null in that case. The session row and cookie value are the
 * same as the GitHub callback's (mintSessionToken).
 */
async function createSessionIfEmailOnly(
  d1: D1Database,
  userId: number,
  name: string | null,
): Promise<CreatedSession | null> {
  const now = Date.now();
  const minted = mintSessionToken(now);
  const [, insert] = await d1.batch([
    d1
      .prepare(
        `UPDATE users SET last_seen_at = ?1, name = COALESCE(name, ?2)
         WHERE id = ?3 AND github_id IS NULL`,
      )
      .bind(now, name, userId),
    d1
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
         SELECT ?1, ?2, ?3, ?4, NULL
         WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2 AND github_id IS NULL)`,
      )
      .bind(minted.sessionId, userId, now, minted.expiresAt),
  ]);
  return (insert.meta.changes ?? 0) > 0 ? minted : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Completing a sign-in (POST /auth/email/verify)
// ─────────────────────────────────────────────────────────────────────────────

export type SignInResult =
  | { kind: "invalid" }
  | { kind: "github" }
  | { kind: "name-required"; email: string }
  | { kind: "ok"; session: CreatedSession; destination: string };

/** Test seams: run between the steps where a concurrent change can land. */
export interface SignInHooks {
  beforeConsume?: () => Promise<void>;
  beforeWrite?: (userId: number) => Promise<void>;
}

/**
 * Uses a token and signs the person in.
 *
 *   1. Look before using: refuse an account with a github_id, and require a
 *      name on a first sign-in, without spending the link.
 *   2. Use the token (atomic, clock read at that moment).
 *   3. Find or create the email-only account.
 *   4. Record the sign-in and create the session, conditional in SQL on the
 *      account still having no github_id.
 */
export async function completeEmailSignIn(
  env: Env,
  input: { token: string; name: unknown },
  hooks: SignInHooks = {},
): Promise<SignInResult> {
  const config = emailLoginConfig(env);
  const d1 = env.AUTH_DB;
  const db = drizzle(d1, { schema });
  if (!isRawToken(input.token)) return { kind: "invalid" };

  const peeked = await peekToken(d1, input.token);
  if (!peeked) return { kind: "invalid" };
  const before = await findUserByEmail(db, peeked.email);
  if (before && before.githubId !== null) return { kind: "github" };
  const name = cleanName(input.name);
  if ((!before || !before.name) && !name) {
    return { kind: "name-required", email: peeked.email };
  }

  await hooks.beforeConsume?.();
  const used = await consumeToken(d1, input.token);
  if (!used) return { kind: "invalid" };

  const user =
    (await findUserByEmail(db, used.email)) ??
    (await createEmailUser(d1, db, used.email, name, Date.now()));
  if (user.githubId !== null) return { kind: "github" };

  await hooks.beforeWrite?.(user.id);
  const session = await createSessionIfEmailOnly(d1, user.id, name);
  if (!session) return { kind: "github" };
  return { kind: "ok", session, destination: destinationFor(config.appUrl, used.return_to) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages — rendered by the email Worker's AuthEmail entrypoint
// ─────────────────────────────────────────────────────────────────────────────

type AuthEmailService = { sendAuthEmail(req: AuthEmailRequest): Promise<SendResult> };

async function deliver(env: Env, req: AuthEmailRequest): Promise<void> {
  const service = (env as unknown as { AUTH_EMAIL?: AuthEmailService }).AUTH_EMAIL;
  if (!service) {
    logError(new Error("AUTH_EMAIL binding missing"), { action: "email.request.send", kind: req.kind });
    return;
  }
  const result = await service.sendAuthEmail(req);
  if (!result.ok) {
    logError(new Error("sign-in email not sent"), {
      action: "email.request.send",
      kind: req.kind,
      reason: result.reason,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The background half of POST /auth/email/request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything that depends on whether the address is known runs here, inside
 * ctx.waitUntil, after the response has been decided. The response is the
 * same "check your email" redirect for every allowed address, and it does not
 * wait for any of this.
 *
 *   1. Per-address rate limit (keyed by the SHA-256 of the limit key).
 *   2. An account with a github_id gets the GitHub notice, recorded as a used
 *      token row so it counts toward the hourly cap.
 *   3. Anyone else gets a fresh link, unless the hourly cap applies.
 */
export async function processEmailRequest(
  env: Env,
  input: { email: string; returnTo: string; locale: Locale },
): Promise<void> {
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `email-request-address:${sha256Hex(limitKey(input.email))}`,
    });
    if (!success) return;

    const config = emailLoginConfig(env);
    const d1 = env.AUTH_DB;
    const db = drizzle(d1, { schema });
    const user = await findUserByEmail(db, input.email);
    const common = { to: input.email, locale: input.locale, minutes: TOKEN_TTL_MINUTES };

    if (user && user.githubId !== null) {
      const id = sha256Hex(encodeHexLowerCase(crypto.getRandomValues(new Uint8Array(32))));
      const recorded = await insertTokenRow(d1, { id, ...input, consumed: true }, Date.now());
      if (!recorded) return;
      await deliver(env, { ...common, kind: "github-notice", url: appUrl(config.appUrl, "/login") });
      return;
    }

    const raw = await issueToken(d1, input);
    if (!raw) return;
    const url = `${appUrl(config.appUrl, "/email/verify")}?token=${raw}`;
    await deliver(env, { ...common, kind: "sign-in-link", url });
  } catch (error) {
    logError(error, { action: "email.request.background" });
  }
}

/** Re-validates a stored return_to and turns it into an absolute URL. */
export function destinationFor(appUrlVar: string, storedReturnTo: string | null): string {
  const returnTo = safeReturnTo(storedReturnTo);
  const origin = new URL(appUrlVar).origin;
  return returnTo === "/"
    ? new URL(BASENAME, origin).toString() // → https://ampl.tools/auth
    : new URL(returnTo, origin).toString(); // → https://ampl.tools/paleography/...
}
