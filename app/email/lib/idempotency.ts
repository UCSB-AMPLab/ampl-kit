/**
 * Idempotency insert helper
 *
 * This file wraps the D1 insert into the `sends` table with a try/catch around
 * the `UNIQUE constraint failed` error on `idempotency_key`. When the key is
 * new, it inserts and returns `{ inserted: true, id }`. When the key already
 * exists, it looks up the first row and returns `{ inserted: false, id }` — no
 * second Resend call, no second row.
 *
 * SQLite (and D1) treats NULLs as distinct in UNIQUE indexes, so rows with a
 * null `idempotency_key` are always inserted — each call is its own send.
 * This is intentional.
 *
 * @version v0.1.0
 */

import { eq } from "drizzle-orm";
import type { EmailDB } from "../db/client.email";
import { schema } from "../db/client.email";

/** The shape of a `sends` insert row passed by the `send()` pipeline. */
export type SendInsertRow = typeof schema.sends.$inferInsert;

/**
 * Insert a send row or deduplicate on idempotency key.
 *
 * @param db  - Drizzle client bound to `EMAIL_DB`
 * @param row - the sends row to insert (may include or omit `idempotencyKey`)
 * @returns `{ inserted: true, id }` for a new send;
 *          `{ inserted: false, id }` for a duplicate key (existing row id returned)
 */
export async function insertSendOrDedup(
  db: EmailDB,
  row: SendInsertRow,
): Promise<{ inserted: boolean; id: number }> {
  try {
    const [result] = await db
      .insert(schema.sends)
      .values(row)
      .returning({ id: schema.sends.id });
    return { inserted: true, id: result.id };
  } catch (err) {
    // D1/SQLite UNIQUE constraint violation on idempotency_key.
    // The error text varies by environment:
    //   Standard SQLite: "UNIQUE constraint failed: sends.idempotency_key"
    //   D1 miniflare:    "D1_ERROR: UNIQUE constraint failed: sends.idempotency_key: SQLITE_CONSTRAINT"
    //   D1 production:   wraps the same message in a "Failed query: …" outer message
    // Check for the stable substring that appears in all forms.
    const isConstraintError =
      err instanceof Error &&
      (err.message.includes("UNIQUE constraint failed") ||
        (err.cause instanceof Error &&
          err.cause.message.includes("UNIQUE constraint failed")));

    if (isConstraintError) {
      const existing = await db
        .select({ id: schema.sends.id })
        .from(schema.sends)
        .where(eq(schema.sends.idempotencyKey, row.idempotencyKey!))
        .get();
      return { inserted: false, id: existing!.id };
    }
    throw err;
  }
}
