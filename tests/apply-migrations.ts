/**
 * Test database setup
 *
 * This file runs once before any test in the suite. It applies the project's
 * D1 migrations to the in-memory miniflare database that the Cloudflare Workers
 * test pool hands to every test — so each test starts against a schema that
 * matches production. The list of migrations is injected at runtime by the
 * `bindings` block in `vitest.config.ts`.
 *
 * @version v0.1.0
 */

import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.AUTH_DB, env.TEST_MIGRATIONS);
});
