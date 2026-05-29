/**
 * Quota enforcement tests — ampl-email Worker
 *
 * Tests the `checkQuota` helper against the EMAIL_DB harness. Covers:
 *   - Under quota: returns "ok"
 *   - Monthly ceiling reached: returns "monthly_exceeded"
 *   - Daily ceiling reached: returns "daily_exceeded"
 *
 * Rows are seeded directly into `sends` so we can deterministically control
 * the quota state without going through the full `send()` pipeline.
 *
 * @version v0.1.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getEmailDb, schema } from "../helpers/email-db";
import { checkQuota } from "../../app/email/lib/quota";

/** Insert N `sends` rows with status "sent" at the given timestamp. */
async function seedSends(
  db: ReturnType<typeof getEmailDb>,
  count: number,
  sentAt: number,
) {
  const rows = Array.from({ length: count }, (_, i) => ({
    tool: "calamus" as const,
    recipient: `user${i}@ampl.tools`,
    subject: `[Calamus] Test ${i}`,
    status: "sent",
    sentAt,
    createdAt: sentAt,
  }));
  for (const row of rows) {
    await db.insert(schema.sends).values(row);
  }
}

describe("checkQuota", () => {
  let db: ReturnType<typeof getEmailDb>;
  const now = Date.now();
  // A timestamp guaranteed to be within the current calendar month and day
  const thisMonthTs = now;

  beforeEach(() => {
    db = getEmailDb();
  });

  it("returns 'ok' when no sends have been made", async () => {
    const result = await checkQuota(db, { monthly: 2500, daily: 90 });
    expect(result).toBe("ok");
  });

  it("returns 'monthly_exceeded' when monthly ceiling is reached", async () => {
    // Seed exactly 2500 sent rows within this calendar month
    await seedSends(db, 2500, thisMonthTs);
    const result = await checkQuota(db, { monthly: 2500, daily: 90 });
    expect(result).toBe("monthly_exceeded");
  });

  it("returns 'daily_exceeded' when daily guard is reached (under monthly ceiling)", async () => {
    // Seed exactly 90 sent rows today (well under monthly ceiling)
    await seedSends(db, 90, thisMonthTs);
    const result = await checkQuota(db, { monthly: 2500, daily: 90 });
    expect(result).toBe("daily_exceeded");
  });

  it("counts only 'sent' status rows for quota", async () => {
    // Seed 2500 rows with status "suppressed" — should NOT count toward quota
    const suppressedRows = Array.from({ length: 2500 }, (_, i) => ({
      tool: "calamus" as const,
      recipient: `user${i}@ampl.tools`,
      subject: `[Calamus] Suppressed ${i}`,
      status: "suppressed",
      sentAt: thisMonthTs,
      createdAt: thisMonthTs,
    }));
    for (const row of suppressedRows) {
      await db.insert(schema.sends).values(row);
    }
    const result = await checkQuota(db, { monthly: 2500, daily: 90 });
    expect(result).toBe("ok");
  });
});
