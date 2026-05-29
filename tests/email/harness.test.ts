/**
 * Email harness smoke test
 *
 * This is the Wave 0 proof that the email test harness is correctly wired:
 * migrations applied, `EMAIL_DB` mounted, and the Drizzle client can round-trip
 * a row through the `sends` table. If this test passes, Plans 02 and 03 have a
 * working, migrated foundation to build their full integration tests on.
 *
 * Pattern: insert a `sends` row directly via the email-db helper, select it
 * back by id, and assert on both the returned value and the DB row — the same
 * dual-assertion pattern as `tests/sessions.test.ts`.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getEmailDb, schema } from "../helpers/email-db";

describe("email harness — sends round-trip", () => {
  it("inserts a sends row and reads it back by id", async () => {
    const db = getEmailDb();
    const now = Date.now();

    const [inserted] = await db
      .insert(schema.sends)
      .values({
        tool: "calamus",
        recipient: "test@ampl.tools",
        subject: "[Calamus] Harness test",
        status: "sent",
        resendId: "test-resend-id-001",
        idempotencyKey: "harness-test-key-001",
        sentAt: now,
        createdAt: now,
      })
      .returning({ id: schema.sends.id });

    expect(inserted).toBeDefined();
    expect(typeof inserted.id).toBe("number");

    const row = await db
      .select()
      .from(schema.sends)
      .where(eq(schema.sends.id, inserted.id))
      .get();

    expect(row).toBeDefined();
    expect(row?.tool).toBe("calamus");
    expect(row?.recipient).toBe("test@ampl.tools");
    expect(row?.idempotencyKey).toBe("harness-test-key-001");
    expect(row?.status).toBe("sent");
  });

  it("enforces UNIQUE constraint on idempotency_key — second insert with same key is rejected", async () => {
    const db = getEmailDb();
    const now = Date.now();

    await db.insert(schema.sends).values({
      tool: "scheduling",
      recipient: "user@ampl.tools",
      subject: "[Scheduling] Confirmation",
      status: "sent",
      idempotencyKey: "harness-dedup-key-001",
      sentAt: now,
      createdAt: now,
    });

    await expect(
      db.insert(schema.sends).values({
        tool: "scheduling",
        recipient: "user@ampl.tools",
        subject: "[Scheduling] Confirmation",
        status: "sent",
        idempotencyKey: "harness-dedup-key-001",
        sentAt: now,
        createdAt: now,
      }),
    ).rejects.toThrow();
  });

  it("allows multiple rows with null idempotency_key (non-idempotent sends)", async () => {
    const db = getEmailDb();
    const now = Date.now();

    await db.insert(schema.sends).values({
      tool: "calamus",
      recipient: "multi@ampl.tools",
      subject: "[Calamus] No key 1",
      status: "sent",
      idempotencyKey: null,
      sentAt: now,
      createdAt: now,
    });

    await expect(
      db.insert(schema.sends).values({
        tool: "calamus",
        recipient: "multi@ampl.tools",
        subject: "[Calamus] No key 2",
        status: "sent",
        idempotencyKey: null,
        sentAt: now,
        createdAt: now,
      }),
    ).resolves.toBeDefined();
  });

  it("inserts a suppressions row and reads it back by address", async () => {
    const db = getEmailDb();
    const now = Date.now();

    await db.insert(schema.suppressions).values({
      address: "suppressed@ampl.tools",
      reason: "bounce",
      source: "resend_webhook",
      createdAt: now,
    });

    const row = await db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.address, "suppressed@ampl.tools"))
      .get();

    expect(row).toBeDefined();
    expect(row?.reason).toBe("bounce");
    expect(row?.source).toBe("resend_webhook");
  });
});
