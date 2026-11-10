/**
 * users-table rebuild migration tests
 *
 * Migration 0002 rebuilds `users` so `github_id` can be NULL (email-only
 * accounts), adds a UNIQUE index on `email`, and creates `email_login_tokens`.
 * SQLite cannot drop a NOT NULL constraint in place, so the migration copies
 * every row of `users` and `sessions` into new tables and renames them, so
 * that `sessions` keeps pointing at the same ids.
 *
 * Each test puts the database back to its state after migration 0001, seeds
 * it the way production looks today (users with GitHub ids, a live session),
 * runs the 0002 statements in one batch the way `wrangler d1 migrations apply`
 * does, and checks that sessions still validate, ids are kept and never
 * reused, emails are normalized, and that duplicate emails make the migration
 * fail loudly and leave the old table untouched.
 *
 * @version v0.4.0
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { validateSession, users, sessions, type AuthDbSchema } from "@ampl/kit/auth";
import { createSessionForUser, getSessionFromRequest } from "~/sessions.server";
import * as schema from "~/db/schema";
import { normalizeEmail } from "~/lib/email-login.server";

function migration(prefix: string) {
  const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith(prefix));
  if (!m) throw new Error(`migration ${prefix} not found`);
  return m;
}

async function run(queries: string[]) {
  await env.AUTH_DB.batch(queries.map((q) => env.AUTH_DB.prepare(q)));
}

/** Drops the tables 0002 creates or rebuilds and replays 0001. */
async function resetToBefore0002() {
  await run([
    "DROP TABLE IF EXISTS email_login_tokens",
    "DROP TABLE IF EXISTS sessions",
    "DROP TABLE IF EXISTS users",
  ]);
  await run(migration("0001").queries);
}

async function seedOldUser(id: number, githubId: number, email: string, handle: string) {
  await env.AUTH_DB.prepare(
    "INSERT INTO users (id, github_id, email, handle, name, avatar_url, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, githubId, email, handle, `Name ${id}`, `https://avatars.githubusercontent.com/u/${githubId}`, 1000 + id, null)
    .run();
}

async function columnInfo(table: string) {
  const res = await env.AUTH_DB.prepare(`PRAGMA table_info(${table})`).all<{
    name: string;
    notnull: number;
  }>();
  return res.results;
}

describe("migration 0002 — users rebuild", () => {
  it("keeps ids and sessions: an existing session still validates afterwards", async () => {
    await resetToBefore0002();
    await seedOldUser(1, 101, "first@example.com", "first");
    await seedOldUser(2, 102, "  Second@Example.COM ", "second");
    const db = drizzle(env.AUTH_DB, { schema });
    const created = await createSessionForUser(db, 2);

    await run(migration("0002").queries);

    const authDb = drizzle(env.AUTH_DB, { schema: { users, sessions } satisfies AuthDbSchema });
    const request = new Request("https://ampl.tools/paleography/", {
      headers: { Cookie: `__Host-ampl_session=${created.rawCookieValue}` },
    });
    const user = await validateSession(authDb, request);
    expect(user).toEqual({
      id: 2,
      githubId: 102,
      email: "second@example.com",
      handle: "second",
      name: "Name 2",
      avatarUrl: "https://avatars.githubusercontent.com/u/102",
    });
    const resolved = await getSessionFromRequest(db, request);
    expect(resolved?.session.id).toBe(created.sessionId);
    expect(resolved?.user.id).toBe(2);

    const fk = await env.AUTH_DB.prepare("PRAGMA foreign_key_list(sessions)").all<{ table: string; from: string; to: string }>();
    expect(fk.results.map((r) => [r.table, r.from, r.to])).toEqual([["users", "user_id", "id"]]);
    const sessionIdx = await env.AUTH_DB.prepare("PRAGMA index_list(sessions)").all<{ name: string }>();
    expect(sessionIdx.results.map((i) => i.name)).toEqual(
      expect.arrayContaining(["sessions_user_idx", "sessions_expires_idx"]),
    );
    const leftovers = await env.AUTH_DB.prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('users_new', 'sessions_new', '_migration_0002_guard')",
    ).all();
    expect(leftovers.results).toEqual([]);
    // A session for a user id that does not exist is still refused.
    await expect(
      env.AUTH_DB.prepare(
        "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('x', 999, 1, 2)",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY/);

    const rows = await env.AUTH_DB.prepare("SELECT id, github_id, email, created_at FROM users ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: 1, github_id: 101, email: "first@example.com", created_at: 1001 },
      { id: 2, github_id: 102, email: "second@example.com", created_at: 1002 },
    ]);
  });

  it("makes github_id nullable and email unique, and creates email_login_tokens", async () => {
    await resetToBefore0002();
    await seedOldUser(1, 101, "a@example.com", "a");
    await run(migration("0002").queries);

    const cols = await columnInfo("users");
    expect(cols.find((c) => c.name === "github_id")!.notnull).toBe(0);
    expect(cols.find((c) => c.name === "email")!.notnull).toBe(1);

    await env.AUTH_DB.prepare(
      "INSERT INTO users (github_id, email, handle, created_at) VALUES (NULL, 'mail@ucsb.edu', '~x', 1)",
    ).run();
    await expect(
      env.AUTH_DB.prepare(
        "INSERT INTO users (github_id, email, handle, created_at) VALUES (NULL, 'a@example.com', '~y', 1)",
      ).run(),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      env.AUTH_DB.prepare(
        "INSERT INTO users (github_id, email, handle, created_at) VALUES (101, 'other@example.com', 'z', 1)",
      ).run(),
    ).rejects.toThrow(/UNIQUE/);

    const tokenCols = (await columnInfo("email_login_tokens")).map((c) => c.name);
    expect(tokenCols).toEqual(["id", "email", "limit_key", "return_to", "locale", "created_at", "expires_at", "consumed_at"]);
    const idx = await env.AUTH_DB.prepare("PRAGMA index_list(email_login_tokens)").all<{ name: string }>();
    expect(idx.results.map((i) => i.name)).toEqual(
      expect.arrayContaining(["email_login_tokens_email_created_idx", "email_login_tokens_limit_key_created_idx"]),
    );
  });

  it("never reuses the id of a deleted user", async () => {
    await resetToBefore0002();
    await seedOldUser(1, 101, "a@example.com", "a");
    await seedOldUser(2, 102, "b@example.com", "b");
    await seedOldUser(3, 103, "c@example.com", "c");
    await env.AUTH_DB.prepare("DELETE FROM users WHERE id = 3").run();

    await run(migration("0002").queries);

    const inserted = await env.AUTH_DB.prepare(
      "INSERT INTO users (github_id, email, handle, created_at) VALUES (104, 'd@example.com', 'd', 1) RETURNING id",
    ).first<{ id: number }>();
    expect(inserted!.id).toBe(4);
  });

  it("treats tab, newline and carriage-return variants as duplicates", async () => {
    await resetToBefore0002();
    await seedOldUser(1, 101, "dup@x.com", "one");
    await seedOldUser(2, 102, "\tDUP@x.com\n", "two");
    await expect(run(migration("0002").queries)).rejects.toThrow(
      /users_email_duplicates_must_be_zero/,
    );
  });

  it("copies an email with tabs and newlines in the app's normalized form", async () => {
    await resetToBefore0002();
    await seedOldUser(1, 101, "\r\n\tMixed@X.com \t", "one");
    await run(migration("0002").queries);
    const row = await env.AUTH_DB.prepare("SELECT email FROM users WHERE id = 1").first<{ email: string }>();
    expect(row!.email).toBe(normalizeEmail("\r\n\tMixed@X.com \t"));
    expect(row!.email).toBe("mixed@x.com");
  });

  it("fails loudly on duplicate emails (case and whitespace included) and changes nothing", async () => {
    await resetToBefore0002();
    await seedOldUser(1, 101, "dup@example.com", "one");
    await seedOldUser(2, 102, " DUP@example.com", "two");
    const db = drizzle(env.AUTH_DB, { schema });
    const created = await createSessionForUser(db, 1);

    await expect(run(migration("0002").queries)).rejects.toThrow(
      /users_email_duplicates_must_be_zero/,
    );

    const cols = await columnInfo("users");
    expect(cols.find((c) => c.name === "github_id")!.notnull).toBe(1);
    const count = await env.AUTH_DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(count!.n).toBe(2);
    const tables = await env.AUTH_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users_new', 'email_login_tokens')",
    ).all();
    expect(tables.results).toEqual([]);
    const session = await env.AUTH_DB.prepare("SELECT user_id FROM sessions WHERE id = ?")
      .bind(created.sessionId)
      .first<{ user_id: number }>();
    expect(session!.user_id).toBe(1);
  });
});
