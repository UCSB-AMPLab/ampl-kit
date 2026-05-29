/**
 * Idempotency tests — ampl-email Worker
 *
 * Tests the insert-or-dedup helper against the EMAIL_DB harness. Covers:
 *   - New idempotency key: inserts and returns { inserted: true, id }
 *   - Duplicate idempotency key: returns { inserted: false, id } of first row
 *     with no second row created
 *   - Null idempotency key: always inserts (SQLite NULLs are distinct in UNIQUE)
 *
 * @version v0.1.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getEmailDb, schema } from "../helpers/email-db";
import { insertSendOrDedup } from "../../app/email/lib/idempotency";

describe("insertSendOrDedup", () => {
  let db: ReturnType<typeof getEmailDb>;
  const now = Date.now();

  const baseRow = {
    tool: "calamus" as const,
    recipient: "test@ampl.tools",
    subject: "[Calamus] Idempotency test",
    status: "sent",
    sentAt: now,
    createdAt: now,
  };

  beforeEach(() => {
    db = getEmailDb();
  });

  it("inserts a new row and returns { inserted: true, id }", async () => {
    const result = await insertSendOrDedup(db, {
      ...baseRow,
      idempotencyKey: "new-key-001",
    });

    expect(result.inserted).toBe(true);
    expect(typeof result.id).toBe("number");

    // Verify the row exists
    const row = await db
      .select()
      .from(schema.sends)
      .where(eq(schema.sends.id, result.id))
      .get();
    expect(row).toBeDefined();
    expect(row?.idempotencyKey).toBe("new-key-001");
  });

  it("returns { inserted: false, id } of first row when key is duplicated", async () => {
    const first = await insertSendOrDedup(db, {
      ...baseRow,
      idempotencyKey: "dedup-key-001",
    });
    expect(first.inserted).toBe(true);

    const second = await insertSendOrDedup(db, {
      ...baseRow,
      idempotencyKey: "dedup-key-001",
    });
    expect(second.inserted).toBe(false);
    // Must return the first row's id
    expect(second.id).toBe(first.id);

    // Only one row should exist with this key
    const rows = await db
      .select()
      .from(schema.sends)
      .where(eq(schema.sends.idempotencyKey, "dedup-key-001"));
    expect(rows).toHaveLength(1);
  });

  it("allows multiple rows with null idempotency key (non-idempotent sends)", async () => {
    const first = await insertSendOrDedup(db, {
      ...baseRow,
      idempotencyKey: null,
    });
    expect(first.inserted).toBe(true);

    const second = await insertSendOrDedup(db, {
      ...baseRow,
      idempotencyKey: null,
    });
    expect(second.inserted).toBe(true);
    // Each null-key send gets its own unique id
    expect(second.id).not.toBe(first.id);
  });
});
