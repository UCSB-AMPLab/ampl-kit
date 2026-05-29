/**
 * Test-side Drizzle client for the email Worker
 *
 * This module gives email Worker integration tests a direct line to the test
 * `EMAIL_DB`. It opens a Drizzle client over the in-memory database that the
 * Cloudflare Workers test pool provides, using the email schema (sends +
 * suppressions). Seeding rows directly lets tests set up their world without
 * driving the full `send()` RPC code path — so quota, suppression, and
 * idempotency logic can be tested in isolation against a known D1 state.
 *
 * @version v0.1.0
 */

import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../app/email/db/schema.email";

export type TestEmailDb = ReturnType<typeof drizzle<typeof schema>>;

export function getEmailDb(): TestEmailDb {
  return drizzle(env.EMAIL_DB, { schema });
}

export { schema };
