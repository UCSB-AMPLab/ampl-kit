/**
 * Quota enforcement
 *
 * This file exposes `checkQuota(db, limits)` — a calendar-month and daily
 * COUNT(*) over the `sends` table (status = "sent"). The Worker calls this
 * before the idempotency insert so over-quota requests are rejected before any
 * Resend interaction. Both ceilings are configurable from `wrangler.email.jsonc`
 * `vars` (`MONTHLY_QUOTA_CEILING` / `DAILY_QUOTA_CEILING`) so they can be
 * tightened or loosened without a code deploy.
 *
 * Calendar-month window: the quota window mirrors Resend's monthly reset,
 * which is UTC-based. Using `Date.UTC(...)` avoids off-by-one errors around
 * midnight in local timezones.
 *
 * Daily guard: a separate UTC day ceiling provides a second line of defence
 * against burst overuse that stays within the monthly budget overall.
 *
 * @version v0.1.0
 */

import { sql, and, eq, gte } from "drizzle-orm";
import type { EmailDB } from "../db/client.email";
import { schema } from "../db/client.email";
import { logError } from "../../lib/logging.server";

/**
 * Return the start of the current calendar month in UTC milliseconds.
 * Mirrors Resend's monthly reset boundary.
 */
function getMonthStartMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/**
 * Return the start of the current UTC day in milliseconds.
 */
function getDayStartMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Check whether the suite-wide quota allows another send.
 *
 * Checks monthly ceiling first (more expensive to exceed), then daily guard.
 * Returns the first exceeded limit, or "ok" if both pass.
 *
 * @param db     - Drizzle client bound to `EMAIL_DB`
 * @param limits - `{ monthly, daily }` ceiling values (parse from env vars)
 * @returns "ok" | "monthly_exceeded" | "daily_exceeded"
 */
export async function checkQuota(
  db: EmailDB,
  limits: { monthly: number; daily: number },
): Promise<"ok" | "monthly_exceeded" | "daily_exceeded"> {
  try {
    const monthStart = getMonthStartMs();
    const dayStart = getDayStartMs();

    const [monthRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sends)
      .where(
        and(
          eq(schema.sends.status, "sent"),
          gte(schema.sends.sentAt, monthStart),
        ),
      );

    if ((monthRow?.count ?? 0) >= limits.monthly) {
      return "monthly_exceeded";
    }

    const [dayRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sends)
      .where(
        and(
          eq(schema.sends.status, "sent"),
          gte(schema.sends.sentAt, dayStart),
        ),
      );

    if ((dayRow?.count ?? 0) >= limits.daily) {
      return "daily_exceeded";
    }

    return "ok";
  } catch (err) {
    logError(err, { action: "email.quota" });
    throw err;
  }
}
