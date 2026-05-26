/**
 * Test harness smoke test
 *
 * This test confirms that the test database is real and migrated before any
 * behavioural test runs against it. It checks that the `pings` table — created
 * by the first walking-skeleton migration — actually exists in the in-memory
 * miniflare D1. If this fails, the migrations never applied and every other
 * database test is meaningless, so this is the canary in the harness.
 *
 * @version v0.1.0
 */

import { env } from "cloudflare:test";
import { expect, it } from "vitest";

it("miniflare D1 has the walking-skeleton migration applied (pings table exists)", async () => {
  const result = await env.AUTH_DB
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pings';")
    .first<{ sql: string }>();
  expect(result?.sql).toContain("pings");
});
