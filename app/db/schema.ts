/**
 * Database schema
 *
 * This file declares the shape of the tables this app reads and writes. The
 * canonical `users` and `sessions` definitions live in the shared kit and are
 * re-exported here so the whole app — and the Drizzle migration tooling, which
 * follows this re-export chain — sees one consistent contract. It also defines
 * the small, app-local `pings` table used only as a health probe, and the
 * `email_login_tokens` table behind email sign-in links. This app is
 * the read-write owner of this D1 database; the migrations that build these
 * tables are owned here.
 *
 * @version v0.4.0
 */

// Re-export the kit's read-only AUTH_DB contract.
// users and sessions are the canonical table definitions owned by kit/auth/schema.ts.
// drizzle.config.ts still points here — drizzle-kit follows the re-export chain to
// see all three tables (verified with drizzle-kit v0.31.10).
export { users, sessions } from "../../kit/auth/schema";

// ─────────────────────────────────────────────────────────────────────────────
// pings  — ampl-auth-local health probe; stays local.
// Migration ownership stays here — ampl-auth is the read-write D1 owner.
// ─────────────────────────────────────────────────────────────────────────────
import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";

export const pings = sqliteTable("pings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// email_login_tokens — one row per emailed sign-in link; app-local, not part
// of the kit contract (consumer tools never read it).
//
// `id` is the lowercase hex SHA-256 of the raw token, so a database leak never
// reveals a usable link. `email` is normalized (trimmed, lower-cased).
// `limit_key` is the address without any `+tag`; the hourly cap counts by it.
// `return_to` is the already-validated destination; it is validated again on
// use. A row is usable while `consumed_at` is NULL and `expires_at` is in the
// future; when a new link is requested for the same address, the older unused
// rows are marked consumed.
// ─────────────────────────────────────────────────────────────────────────────
export const emailLoginTokens = sqliteTable(
  "email_login_tokens",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    limitKey: text("limit_key").notNull(),
    returnTo: text("return_to").notNull(),
    locale: text("locale").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (t) => [
    index("email_login_tokens_email_created_idx").on(t.email, t.createdAt),
    index("email_login_tokens_limit_key_created_idx").on(t.limitKey, t.createdAt),
  ],
);
