/**
 * Email database client factory
 *
 * This file hands back a Drizzle query client bound to the email Worker's D1
 * database, the `EMAIL_DB` binding. The email Worker owns this database
 * read-write — it is the single source of truth for the send log and
 * suppression list. No other Worker reads or writes this database directly; the
 * `send()` RPC is the only external interface. Unlike `app/db/client.server.ts`,
 * the `.server.ts` suffix convention does not apply here because the email
 * Worker has no browser bundle.
 *
 * @version v0.1.0
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.email";

export function getEmailDb(env: Env) {
  return drizzle(env.EMAIL_DB, { schema });
}

export type EmailDB = ReturnType<typeof getEmailDb>;
export { schema };
