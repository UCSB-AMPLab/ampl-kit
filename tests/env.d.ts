/**
 * Test environment type declarations
 *
 * This file teaches TypeScript about the bindings the test pool provides on
 * `env` — the auth Worker bindings (`AUTH_DB`, `TEST_MIGRATIONS`,
 * `AUTH_RATE_LIMITER`) from `vitest.config.ts` and the email Worker bindings
 * (`EMAIL_DB`, `TEST_EMAIL_MIGRATIONS`, etc.) from `vitest.email.config.ts`.
 * Both sets coexist in one `ProvidedEnv` interface because the same `env.d.ts`
 * serves all tests in the `tests/` tree. The `bindings` blocks in the
 * respective vitest configs supply the real values at runtime.
 *
 * @version v0.1.0
 */

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface ProvidedEnv extends Env {
    // Auth Worker bindings (vitest.config.ts)
    AUTH_DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    AUTH_RATE_LIMITER: RateLimit;

    // Email Worker bindings (vitest.email.config.ts)
    EMAIL_DB: D1Database;
    TEST_EMAIL_MIGRATIONS: D1Migration[];
    EMAIL_RATE_LIMITER: RateLimit;
    RESEND_API_KEY: string;
    RESEND_WEBHOOK_SECRET: string;
    UNSUB_HMAC_SECRET: string;
    // Literal types matching wrangler.email.jsonc vars (strict-vars mode)
    MONTHLY_QUOTA_CEILING: "2500";
    DAILY_QUOTA_CEILING: "90";
  }
}

export {};
