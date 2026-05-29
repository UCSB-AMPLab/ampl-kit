/**
 * Suppression check
 *
 * This file exposes a single query: `isSuppressed(db, address)` — a SELECT
 * against the `suppressions` table. It returns `true` if the address has been
 * suppressed for any reason (bounce, complaint, or user unsubscribe) and
 * `false` otherwise. The `send()` pipeline calls this before any Resend work,
 * so a suppressed address never results in a delivery attempt.
 *
 * The suppression list is global — one suppressed address blocks all AMPL mail
 * to that address, regardless of tool. Per-tool scoping is deferred until
 * traffic data justifies it.
 *
 * @version v0.1.0
 */

import { eq } from "drizzle-orm";
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
 * @param db     - Drizzle client bound to `EMAIL_DB`
 * @param address - recipient email address (case/whitespace-insensitive)
 * @returns `true` if a suppressions row exists for this address
 */
export async function isSuppressed(
  db: EmailDB,
  address: string,
): Promise<boolean> {
  const row = await db
    .select({ address: schema.suppressions.address })
    .from(schema.suppressions)
    .where(eq(schema.suppressions.address, normalizeEmail(address)))
    .get();
  return !!row;
}
