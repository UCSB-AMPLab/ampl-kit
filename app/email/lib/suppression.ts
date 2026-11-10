/**
 * Suppression check
 *
 * This file exposes `isSuppressed(db, address)` — a SELECT against the
 * `suppressions` table — and `recordSuppression`, the one write path, which
 * escalates the reason and never downgrades it. It returns `true` if the address has been
 * suppressed for any reason (bounce, complaint, or user unsubscribe) and
 * `false` otherwise. The `send()` pipeline calls this before any Resend work,
 * so a suppressed address never results in a delivery attempt.
 *
 * The suppression list is global — one suppressed address blocks all AMPL mail
 * to that address, regardless of tool. Per-tool scoping is deferred until
 * traffic data justifies it.
 *
 * @version v0.4.0
 */

import { and, eq, ne, sql } from "drizzle-orm";
import type { EmailDB } from "../db/client.email";
import { schema } from "../db/client.email";

/**
 * Normalise an email address for suppression storage and lookup: trim
 * surrounding whitespace and lower-case. Suppression matching is exact at the
 * SQL level, so a bounce for `User@Example.com` must block a later send to
 * `user@example.com`. Every write to and read from `suppressions` MUST
 * pass the address through this function so stored and queried forms agree.
 */
export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Check whether `address` is on the global suppression list. The address is
 * normalised (trim + lower-case) before the lookup, matching the normalised
 * form written by the webhook and unsubscribe handlers.
 *
 * With `ignoreUnsubscribe`, a suppression whose reason is "unsubscribe" does
 * not count, while bounces and complaints still do. Account-access mail
 * (`category: "auth"`) uses this: an unsubscribe from notifications must not
 * stop a person from receiving a sign-in link.
 *
 * @param db     - Drizzle client bound to `EMAIL_DB`
 * @param address - recipient email address (case/whitespace-insensitive)
 * @param opts.ignoreUnsubscribe - skip rows whose reason is "unsubscribe"
 * @returns `true` if a counting suppressions row exists for this address
 */
export async function isSuppressed(
  db: EmailDB,
  address: string,
  opts: { ignoreUnsubscribe?: boolean } = {},
): Promise<boolean> {
  const byAddress = eq(schema.suppressions.address, normalizeEmail(address));
  const row = await db
    .select({ address: schema.suppressions.address })
    .from(schema.suppressions)
    .where(
      opts.ignoreUnsubscribe
        ? and(byAddress, ne(schema.suppressions.reason, "unsubscribe"))
        : byAddress,
    )
    .get();
  return !!row;
}

export type SuppressionReason = "complaint" | "bounce" | "unsubscribe";

/**
 * Records a suppression for `address`, raising the stored reason when the new
 * one ranks higher (complaint > bounce > unsubscribe) and never lowering it.
 * A bounce or complaint for an address that had only unsubscribed must reach
 * the table, because account-access mail ignores unsubscribe-only rows; a
 * later unsubscribe must not turn a bounce back into an unsubscribe. A repeat
 * of the same reason changes nothing, so webhook redelivery is idempotent.
 * The address is normalized first; `created_at` keeps the first suppression.
 */
export async function recordSuppression(
  db: EmailDB,
  address: string,
  reason: SuppressionReason,
  source: "resend_webhook" | "user_request",
): Promise<void> {
  const rank = (col: ReturnType<typeof sql>) =>
    sql`(CASE ${col} WHEN 'complaint' THEN 3 WHEN 'bounce' THEN 2 WHEN 'unsubscribe' THEN 1 ELSE 0 END)`;
  await db.run(sql`
    INSERT INTO suppressions (address, reason, source, created_at)
    VALUES (${normalizeEmail(address)}, ${reason}, ${source}, ${Date.now()})
    ON CONFLICT (address) DO UPDATE SET reason = excluded.reason, source = excluded.source
    WHERE ${rank(sql`excluded.reason`)} > ${rank(sql`suppressions.reason`)}
  `);
}
