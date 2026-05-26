/**
 * Auth database contract
 *
 * This file is the canonical, read-only description of the two database tables
 * the shared AMPL identity system is built on — `users` (one row per person,
 * keyed by their GitHub id) and `sessions` (one row per active sign-in). It is
 * the stable shape that consuming tools pin to, so any change to a column name,
 * a type, an index, or the link between a session and its user is treated as a
 * breaking change. The file defines just those two tables plus two helper
 * types: one describing the read-only slice of the schema a tool binds its
 * database client to, and one describing the user object handed back after a
 * successful session lookup. It intentionally leaves out anything that writes
 * to the database and any tables specific to the auth tool itself — this is the
 * shared surface, nothing more.
 *
 * @version v0.1.0
 */

import { sqliteTable, integer, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────────
// 1. users — canonical AMPL identity, keyed by GitHub id
// ─────────────────────────────────────────────────────────────────────────────
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    githubId: integer("github_id").notNull().unique(),
    email: text("email").notNull(),
    handle: text("handle").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at"),
  },
  (t) => [
    uniqueIndex("users_github_id_unique").on(t.githubId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. sessions — opaque 256-bit token PK; issued after GitHub OAuth
// ─────────────────────────────────────────────────────────────────────────────
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at"),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Contract types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The read-only schema subset that consumer tools bind their Drizzle client to.
 * Typed to only `users` and `sessions` — no write helpers, no `pings`.
 *
 * Usage:
 *   const authDb = drizzle(env.AUTH_DB, { schema: { users, sessions } satisfies AuthDbSchema });
 */
export type AuthDbSchema = { users: typeof users; sessions: typeof sessions };

/**
 * The shape returned by validateSession after a successful session lookup.
 *
 * `id` is the canonical AMPL user id — the value consumer tools should
 * foreign-key their own authorization tables to.
 * `email` is the GitHub-verified primary email (used for invitation matching).
 * `name` and `avatarUrl` are nullable — GitHub profile fields that may be
 * absent for some accounts.
 */
export interface AuthenticatedUser {
  id: number;
  githubId: number;
  email: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
}
