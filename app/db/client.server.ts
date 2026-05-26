/**
 * Database client factory
 *
 * This file hands back a Drizzle query client bound to this app's own D1
 * database, the `AUTH_DB` binding. This app owns that database read-write — it
 * is the single source of truth for accounts and sessions — while sibling tool
 * Workers bind the very same database read-only under the same name to validate
 * sessions they did not create. The `.server.ts` suffix is load-bearing: it
 * guarantees Drizzle and the D1 binding never leak into the browser bundle.
 *
 * @version v0.1.0
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(env: Env) {
  return drizzle(env.AUTH_DB, { schema });
}

export type DB = ReturnType<typeof getDb>;
export { schema };
