/**
 * Test-side Drizzle client and seed helpers
 *
 * This module gives integration tests a direct line to the test database. It
 * opens a Drizzle client over the in-memory `AUTH_DB`, and offers a `seedUser`
 * helper that inserts a user row straight into the table. Seeding directly lets
 * a test set up its world without driving the real GitHub OAuth code path — so,
 * for instance, the auth middleware can be tested in isolation. Genuine session
 * creation still flows through `app/sessions.server.ts`.
 *
 * @version v0.1.0
 */

import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export function getDb(): TestDb {
  return drizzle(env.AUTH_DB, { schema });
}

export async function seedUser(
  email: string,
  handle: string,
  opts: { githubId?: number; name?: string; avatarUrl?: string } = {},
): Promise<number> {
  const db = getDb();
  const githubId = opts.githubId ?? Math.floor(Math.random() * 2 ** 31);
  const createdAt = Date.now();
  const result = await db
    .insert(schema.users)
    .values({
      githubId,
      email,
      handle,
      name: opts.name ?? null,
      avatarUrl: opts.avatarUrl ?? null,
      createdAt,
      lastSeenAt: null,
    })
    .returning({ id: schema.users.id });
  if (result.length === 0) {
    throw new Error("seedUser: insert did not return a row");
  }
  return result[0].id;
}
