/**
 * Test environment type declarations
 *
 * This file teaches TypeScript about the bindings the test pool provides on
 * `env` — the `AUTH_DB` database, the injected `TEST_MIGRATIONS` list, and the
 * `AUTH_RATE_LIMITER` — so test files can reference them without type errors.
 * The `bindings` block in `vitest.config.ts` supplies the real values at runtime.
 *
 * @version v0.1.0
 */

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface ProvidedEnv extends Env {
    AUTH_DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    AUTH_RATE_LIMITER: RateLimit;
  }
}

export {};
