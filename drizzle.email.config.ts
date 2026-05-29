/**
 * Drizzle Kit configuration (ampl-email)
 *
 * This file configures Drizzle Kit — the command-line tool that turns the
 * TypeScript table definitions in `app/email/db/schema.email.ts` into SQL
 * migration files. It targets SQLite (the dialect Cloudflare D1 speaks) and
 * writes the generated migrations into the `drizzle-email/` directory, where
 * Wrangler later applies them to the `ampl-email-db` database. This config is
 * kept separate from `drizzle.config.ts` (auth schema) to avoid accidental
 * merging.
 *
 * @version v0.1.0
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle-email",
  schema: "./app/email/db/schema.email.ts",
  dialect: "sqlite",
});
