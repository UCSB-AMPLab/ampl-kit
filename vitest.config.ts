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
    resolve: {
      alias: {
        // workers/app.ts imports the framework's virtual server build; the
        // request-level tests serve a hand-assembled one in its place.
        "virtual:react-router/server-build": resolve(__dirname, "./tests/helpers/server-build.ts"),
      },
    },
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
            // wrangler.jsonc binds AUTH_EMAIL to the ampl-email Worker, which
            // does not run in this pool. Tests hand routes a fake AUTH_EMAIL
            // through the request context instead; this stub only satisfies
            // the binding.
            serviceBindings: {
              AUTH_EMAIL: () => new Response("AUTH_EMAIL is not available in tests", { status: 503 }),
            },
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Fixture values for secrets provisioned at deploy-time via
              // `wrangler secret put` (per-env). Concrete values need only
              // satisfy runtime-narrowing checks in the code under test.
              SESSION_SECRET: "test-session-secret",
              GITHUB_CLIENT_ID: "test-github-client-id",
              GITHUB_CLIENT_SECRET: "test-github-client-secret",
              // Email sign-in is on in tests. The Turnstile values are the
              // documented Cloudflare test keys (site key always renders,
              // secret always passes); tests stub siteverify, so no request
              // leaves the runtime.
              EMAIL_LOGIN_ENABLED: "true",
              EMAIL_LOGIN_DOMAINS: "ucsb.edu",
              TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
              TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
            },
          },
        },
      },
    },
  };
});
