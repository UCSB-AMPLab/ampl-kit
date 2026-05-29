/**
 * Drizzle schema — ampl-email Worker
 *
 * Defines the two tables that back the email service: `sends` (the send log,
 * recording every delivery attempt with its status, tool, and optional
 * idempotency key) and `suppressions` (the global suppression list, keyed by
 * recipient address). Both are retained indefinitely — no prune column or
 * cron job. The UNIQUE constraints on `idempotency_key` and `address` are the
 * schema-level gates for deduplication and global suppression.
 *
 * @version v0.1.0
 */

import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * `sends` — the email send log.
 *
 * One row per `send()` call. `tool` records the originating tool for per-tool
 * analytics (no schema change needed to add per-tool quota caps later).
 * `idempotency_key` is UNIQUE and nullable — when present, the UNIQUE
 * constraint blocks a duplicate delivery; when absent (null), SQLite treats
 * NULLs as distinct so each non-keyed call is its own row. All timestamps are
 * milliseconds since epoch (integer), never text.
 */
export const sends = sqliteTable(
  "sends",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tool: text("tool").notNull(), // "calamus" | "scheduling"
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull(), // "sent" | "suppressed" | "quota_exceeded" | "duplicate"
    resendId: text("resend_id"), // Resend message id, null on non-delivery
    idempotencyKey: text("idempotency_key"), // caller-supplied, nullable
    sentAt: integer("sent_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("sends_idempotency_key_unique").on(t.idempotencyKey),
    index("sends_recipient_idx").on(t.recipient),
    index("sends_tool_idx").on(t.tool),
    index("sends_sent_at_idx").on(t.sentAt),
  ],
);

/**
 * `suppressions` — the global suppression list.
 *
 * Keyed by recipient address (UNIQUE). Any suppression — bounce, complaint, or
 * explicit unsubscribe — blocks all AMPL mail to that address. The `reason`
 * and `source` columns record why and how the address was suppressed,
 * enabling future auditing without a schema change. Retained indefinitely.
 */
export const suppressions = sqliteTable(
  "suppressions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    address: text("address").notNull().unique(),
    reason: text("reason").notNull(), // "bounce" | "complaint" | "unsubscribe"
    source: text("source").notNull(), // "resend_webhook" | "user_request"
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("suppressions_address_unique").on(t.address)],
);
