/**
 * Database schema
 *
 * This file declares the shape of the tables this app reads and writes. The
 * canonical `users` and `sessions` definitions live in the shared kit and are
 * re-exported here so the whole app — and the Drizzle migration tooling, which
 * follows this re-export chain — sees one consistent contract. It also defines
 * the small, app-local `pings` table used only as a health probe. This app is
 * the read-write owner of this D1 database; the migrations that build these
 * tables are owned here.
 *
 * @version v0.1.0
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
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const pings = sqliteTable("pings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});
