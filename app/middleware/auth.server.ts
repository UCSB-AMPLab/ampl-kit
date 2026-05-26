/**
 * Authentication middleware
 *
 * This file is the gate that stands in front of protected routes. For each
 * incoming request it reads the session cookie, looks the session up in the
 * database, and — if no valid session is found — sends the visitor to the
 * login page, first remembering where they were trying to go so they can be
 * returned there after signing in. When a session does resolve, it attaches
 * the authenticated user to the request context for downstream loaders and
 * actions and quietly rolls the session's expiry forward to keep active users
 * signed in. The remembered destination is stored as a full cross-tool apex
 * path, not a path within this app, because the callback redirects to it with
 * an absolute URL — storing a base-path-stripped value would corrupt that
 * redirect.
 *
 * Behavioural notes:
 *   - `return_to` is stored as the full apex pathname (NOT basename-stripped).
 *     ampl-auth's return_to is a cross-tool apex path (e.g. /palaeography/...),
 *     NOT a path within this app that the router re-prepends. Storing the
 *     stripped path would produce /palaeography/... → /auth/palaeography/... on
 *     consume (double-prefix bug).
 *   - Uses `env.AUTH_DB`.
 *   - `stripBasename` is NOT imported — stripping is forbidden here.
 *   - The /login redirect uses a BARE path (no BASENAME) — RR re-prepends the
 *     basename once, so prepending it here would double to /auth/auth/login.
 *
 * Shared-kit sourcing:
 *   - `safeReturnTo` is sourced from @ampl/kit/auth (not defined locally).
 *   - `AuthenticatedUser` type sourced from @ampl/kit/auth via ~/context re-export.
 *   - `authMiddleware` continues calling local `getSessionFromRequest` (returns the
 *     session row needed for `rollSessionIfIdle`; the kit's validateSession omits it).
 *
 * @version v0.1.0
 */

import { redirect } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import type { MiddlewareFunction } from "react-router";
import * as schema from "~/db/schema";
import {
  getSessionFromRequest,
  rollSessionIfIdle,
} from "~/sessions.server";
import { cloudflareContext, userContext } from "~/context";
import { logError } from "~/lib/logging.server";
import { safeReturnTo } from "@ampl/kit/auth";
// NOTE: stripBasename is intentionally NOT imported — stripping is forbidden here.

export const authMiddleware: MiddlewareFunction = async (
  { request, context },
  next,
) => {
  try {
    const { env } = context.get(cloudflareContext);
    const db = drizzle(env.AUTH_DB, { schema });
    const resolved = await getSessionFromRequest(db, request);
    if (!resolved) {
      const url = new URL(request.url);
      // Store the FULL apex pathname (not basename-stripped).
      // return_to is a cross-tool apex path (e.g. /palaeography/settings),
      // not a path within this app's /auth basename. The callback
      // uses an absolute URL redirect that does not re-prepend the
      // basename — so storing the full path is correct.
      const returnTo = encodeURIComponent(url.pathname + url.search);
      // Bare in-app path (no BASENAME): React Router re-prepends the basename
      // once, so prepending it here would double to /auth/auth/login → 500.
      throw redirect(`/login?return_to=${returnTo}`);
    }
    context.set(userContext, resolved.user);
    await rollSessionIfIdle(db, resolved.session);
    return await next();
  } catch (error) {
    if (error instanceof Response) throw error; // preserve redirect
    logError(error, { action: "auth.middleware" });
    throw error;
  }
};
