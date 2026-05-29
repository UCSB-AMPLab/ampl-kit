/**
 * Vitest configuration (Cloudflare Workers pool)
 *
 * This file sets up Vitest to run the test suite inside the real Cloudflare
 * Workers runtime via `@cloudflare/vitest-pool-workers`, so tests exercise the
 * same environment the code runs in production. Before the suite runs it reads
 * the D1 migrations from `drizzle/` and replays them into an in-memory miniflare
 * database, binds that database as `AUTH_DB`, and supplies harmless fixture
 * values for the secrets the code expects at runtime.
 *
 * @version v0.1.0
 */
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults } from "vitest/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(resolve(__dirname, "./drizzle"));
  return {
    plugins: [tsconfigPaths()],
    test: {
      // The email Worker tests need EMAIL_DB + email migrations, supplied only
      // by vitest.email.config.ts. Exclude them here so the default suite (and
      // `npm test` in CI) does not run them against the auth AUTH_DB setup.
      exclude: [...configDefaults.exclude, "tests/email/**"],
      setupFiles: ["./tests/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: {
            configPath: "./wrangler.jsonc",
          },
          miniflare: {
            d1Databases: {
              AUTH_DB: "ampl-auth-db",
            },
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Fixture values for secrets provisioned at deploy-time via
              // `wrangler secret put` (per-env). Concrete values need only
              // satisfy runtime-narrowing checks in the code under test.
              SESSION_SECRET: "test-session-secret",
              GITHUB_CLIENT_ID: "test-github-client-id",
              GITHUB_CLIENT_SECRET: "test-github-client-secret",
            },
          },
        },
      },
    },
  };
});
