/**
 * Vitest configuration (Cloudflare Workers pool — ampl-email Worker)
 *
 * This file sets up a second Vitest configuration for the email Worker tests.
 * It mirrors `vitest.config.ts` (the auth Worker config) but points at
 * `wrangler.email.jsonc` and mounts `EMAIL_DB` instead of `AUTH_DB`. Before
 * the suite runs it reads the D1 migrations from `drizzle-email/` and replays
 * them into an in-memory miniflare database bound as `EMAIL_DB`. Fixture values
 * for the secrets the email Worker expects at runtime are injected via `bindings`.
 * Kept separate from the auth config — the two Workers have different bindings
 * and must not share migration state.
 *
 * @version v0.1.0
 */
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(resolve(__dirname, "./drizzle-email"));
  return {
    plugins: [tsconfigPaths()],
    test: {
      // Scope this config to the email Worker tests only. They require EMAIL_DB
      // + the drizzle-email migrations applied below; the auth suite runs under
      // vitest.config.ts with a different DB and must not be picked up here.
      include: ["tests/email/**/*.test.ts"],
      setupFiles: ["./tests/apply-email-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: {
            configPath: "./wrangler.email.jsonc",
          },
          miniflare: {
            d1Databases: {
              EMAIL_DB: "ampl-email-db",
            },
            bindings: {
              TEST_EMAIL_MIGRATIONS: migrations,
              // Fixture values for secrets provisioned at deploy-time via
              // `wrangler secret put --config wrangler.email.jsonc`. These
              // values need only satisfy runtime-narrowing checks; they are
              // never used for actual Resend or HMAC operations in unit tests.
              RESEND_API_KEY: "test-resend-api-key",
              RESEND_WEBHOOK_SECRET: "whsec_dGVzdHNlY3JldA==",
              UNSUB_HMAC_SECRET: "test-unsub-hmac-secret-32bytes!!",
              MONTHLY_QUOTA_CEILING: "2500",
              DAILY_QUOTA_CEILING: "90",
            },
          },
        },
      },
    },
  };
});
