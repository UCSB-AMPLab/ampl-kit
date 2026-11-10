/**
 * GitHub account resolution
 *
 * Given a GitHub profile and its verified primary email, finds or creates the
 * AMPL user, by github_id first:
 *   - a row with this github_id → refresh its profile; the email changes only
 *     when no other row has the new address, otherwise the old one is kept;
 *   - else a row with this email and github_id NULL (an account created
 *     through an email sign-in link) → link it: set github_id, handle and
 *     avatar_url on that row, so its id is kept;
 *   - else a row with this email and a different github_id → refuse with
 *     `email-in-use`; two GitHub-linked rows are never merged;
 *   - else insert a new row.
 *
 * Concurrent writes can land between the lookups and the write. A unique
 * violation on the returning-user update drops the email change; a unique
 * violation on the insert re-runs both lookups and applies the same rules
 * once more. The `afterLookup` hook exists so tests can land such a write.
 *
 * @version v0.4.0
 */

import { and, eq, isNull, ne } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { users } from "~/db/schema";
import { isUniqueViolation } from "~/lib/db-errors.server";
import { logError } from "~/lib/logging.server";

type Db = DrizzleD1Database<typeof schema>;
type UserRow = typeof users.$inferSelect;

export interface GithubProfile {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  /** Verified primary email, already normalized. */
  email: string;
}

export type ResolveResult =
  | { ok: true; user: UserRow }
  | { ok: false; error: "email-in-use" | "oauth-failed" };

export interface ResolveHooks {
  afterLookup?: () => Promise<void>;
}

function byGithubId(db: Db, githubId: number) {
  return db.select().from(users).where(eq(users.githubId, githubId)).get();
}

/** Links an email-only row, or refuses when the row has another github_id. */
async function linkOrRefuse(
  db: Db,
  p: GithubProfile,
  sameEmail: UserRow,
  now: number,
): Promise<ResolveResult> {
  if (sameEmail.githubId !== null) {
    logError(new Error("GitHub sign-in email belongs to another GitHub-linked account"), {
      action: "auth.callback.emailInUse",
      userId: String(sameEmail.id),
    });
    return { ok: false, error: "email-in-use" };
  }
  // The WHERE re-checks github_id IS NULL so a concurrent link cannot
  // overwrite another.
  const [linked] = await db
    .update(users)
    .set({ githubId: p.githubId, handle: p.login, avatarUrl: p.avatarUrl, lastSeenAt: now })
    .where(and(eq(users.id, sameEmail.id), isNull(users.githubId)))
    .returning();
  const user = linked ?? (await byGithubId(db, p.githubId));
  return user ? { ok: true, user } : { ok: false, error: "oauth-failed" };
}

export async function resolveGithubAccount(
  db: Db,
  p: GithubProfile,
  hooks: ResolveHooks = {},
): Promise<ResolveResult> {
  const now = Date.now();
  const existing = await byGithubId(db, p.githubId);

  if (existing) {
    const owner = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, p.email), ne(users.id, existing.id)))
      .get();
    await hooks.afterLookup?.();
    const update = { handle: p.login, avatarUrl: p.avatarUrl, name: p.name, lastSeenAt: now };
    try {
      await db
        .update(users)
        .set(owner ? update : { ...update, email: p.email })
        .where(eq(users.id, existing.id));
    } catch (error) {
      if (owner || !isUniqueViolation(error)) throw error;
      // Another row took the address between the check and the update:
      // keep the old address.
      await db.update(users).set(update).where(eq(users.id, existing.id));
    }
    const user = await byGithubId(db, p.githubId);
    return user ? { ok: true, user } : { ok: false, error: "oauth-failed" };
  }

  const sameEmail = await db.select().from(users).where(eq(users.email, p.email)).get();
  if (sameEmail) return linkOrRefuse(db, p, sameEmail, now);

  await hooks.afterLookup?.();
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        githubId: p.githubId,
        email: p.email,
        handle: p.login,
        name: p.name,
        avatarUrl: p.avatarUrl,
        createdAt: now,
        lastSeenAt: now,
      })
      .returning();
    return { ok: true, user: inserted };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent write took the github_id or the email first: look again
    // and apply the same rules.
    const byId = await byGithubId(db, p.githubId);
    if (byId) return { ok: true, user: byId };
    const raced = await db.select().from(users).where(eq(users.email, p.email)).get();
    if (raced) return linkOrRefuse(db, p, raced, now);
    logError(error, { action: "auth.callback.insert" });
    return { ok: false, error: "oauth-failed" };
  }
}
