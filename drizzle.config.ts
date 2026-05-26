/**
 * Drizzle Kit configuration
 *
 * This file configures Drizzle Kit — the command-line tool that turns the
 * TypeScript table definitions in `app/db/schema.ts` into SQL migration files.
 * It targets SQLite (the dialect Cloudflare D1 speaks) and writes the generated
 * migrations into the `drizzle/` directory, where Wrangler later applies them
 * to the database.
 *
 * @version v0.1.0
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./app/db/schema.ts",
  dialect: "sqlite",
});
