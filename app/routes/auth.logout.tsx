/**
 * Sign out
 *
 * This file signs a user out of the current device. It is a POST-only action
 * with no UI: it resolves the session cookie, deletes that one session row
 * from the database — only this device's session, never the user's others —
 * and clears the session cookie. It then redirects the user onward, honouring
 * an optional `return_to` so a tool can send the user back to itself after
 * sign-out, with `safeReturnTo` guarding that destination against
 * open-redirect tricks. A per-IP rate limit guards against flooding, and a
 * GET request gets an automatic 405 because only the action is exported.
 *
 * Behaviour:
 *
 *   1. DB binding: env.AUTH_DB.
 *   2. Redirect target: absolute URL to bypass the /auth basename prepend
 *      that RR v7 adds to relative redirect() calls (same rationale
 *      as the callback route).
 *   3. Device-only logout: deletes only the current session row, not
 *      all sessions for the user.
 *   4. Safe apex return_to: reads optional
 *      ?return_to= query param, validates with safeReturnTo from @ampl/kit/auth,
 *      and redirects to the absolute apex URL. Reuses the same absolute-URL
 *      bypass as the callback route.
 *      POST /auth/logout?return_to=/palaeography → https://<origin>/palaeography
 *      POST /auth/logout?return_to=//evil.com → safeReturnTo rejects → /auth/login
 *
 * Only `action` is exported — no `loader`, no default component. React Router
 * v7 automatically returns 405 for GET requests when only `action` is present.
 *
 * Threat-model linkages:
 *   - Flood: AUTH_RATE_LIMITER per-IP on logout:<ip>.
 *   - Open redirect: safeReturnTo guards return_to before redirect.
 *   - Double-prefix: absolute-URL bypass (new URL(returnTo, origin)).
 *
 * @version v0.1.0
 */

import { redirect, data } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import {
  getSessionFromRequest,
  destroySession,
  clearSessionCookieHeader,
} from "~/sessions.server";
import { cloudflareContext } from "~/context";
import { logError } from "~/lib/logging.server";
import { BASENAME } from "~/lib/paths";
import { safeReturnTo } from "@ampl/kit/auth";
import type { Route } from "./+types/auth.logout";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.AUTH_RATE_LIMITER.limit({
    key: `logout:${ip}`,
  });
  if (!success) {
    logError(new Error("logout rate limited"), {
      action: "auth.logout.ratelimit",
      ip,
    });
    return data({ error: "rate-limited" }, { status: 429 });
  }
  try {
    const db = drizzle(env.AUTH_DB, { schema });
    const resolved = await getSessionFromRequest(db, request);
    if (resolved) {
      // Device-only logout — deletes only this session row.
      await destroySession(db, resolved.session.id);
    }
    const isSecure = new URL(request.url).protocol === "https:";
    const origin = new URL(request.url).origin;

    // Honor a safe apex return_to so tools can send users back after sign-out.
    // safeReturnTo guards against open-redirect (protocol-relative, backslash, etc.).
    const rawReturnTo = new URL(request.url).searchParams.get("return_to") ?? "";
    const returnTo = safeReturnTo(rawReturnTo);

    // Absolute-URL bypass — a relative redirect would have RR v7 prepend /auth,
    // turning /palaeography into /auth/palaeography (double-prefix). Use new URL()
    // to build an absolute URL, identical to the pattern in auth.callback.tsx.
    const destination =
      returnTo === "/"
        ? new URL(BASENAME + "/login", origin).toString() // no return_to → /auth/login
        : new URL(returnTo, origin).toString();           // → https://<origin>/palaeography

    throw redirect(destination, {
      headers: { "Set-Cookie": clearSessionCookieHeader(isSecure) },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    logError(error, { action: "auth.logout" });
    throw error;
  }
}
