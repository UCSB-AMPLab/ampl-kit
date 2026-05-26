/**
 * GitHub OAuth callback
 *
 * This file handles the second half of signing in with GitHub. After a user
 * approves the app on GitHub, GitHub sends them back here with a one-time
 * `code`. This route checks the anti-forgery `state`, trades the code for an
 * access token, reads the user's GitHub profile and verified email, creates or
 * updates their account, mints a session cookie, and redirects them back to
 * wherever they started. It is loader-only — it renders no UI.
 *
 * Implementation notes:
 *
 *   1. Provider: arctic.GitHub (state-only; no PKCE, no verifier cookie).
 *   2. Cookies: github_oauth_state / github_return_to.
 *      No verifier to read or clear; return_to carries the post-login destination.
 *   3. Token exchange: validateAuthorizationCode(code) only — no verifier arg.
 *      Access token via tokens.accessToken() (NOT tokens.idToken(), which would throw).
 *   4. Identity: GitHub REST (GET /user + GET /user/emails).
 *      MUST send User-Agent: ampl-auth — Cloudflare Workers does not auto-set it.
 *   5. Account resolution: upsert-by-github_id (INSERT when absent, UPDATE profile when present).
 *      Any GitHub user can sign in.
 *   6. Post-login redirect: ABSOLUTE URL via new URL(returnTo, origin) to bypass the /auth
 *      basename prepend that RR v7 adds to relative redirect() calls.
 *   7. Error codes (5): oauth-failed, oauth-cancelled, state-mismatch, no-verified-email, rate-limited.
 *   8. DB binding: env.AUTH_DB.
 *
 * Threat-model linkages:
 *   - CSRF: github_oauth_state cookie compared to URL state before exchange.
 *   - Unverified email: gate on primary && verified in /user/emails.
 *   - Open redirect: safeReturnTo applied before absolute URL construction.
 *   - Duplicate identity rows: upsert keyed by unique github_id index.
 *   - GitHub 403 from missing UA: User-Agent: ampl-auth on all GitHub REST calls.
 *   - Flood: AUTH_RATE_LIMITER per-IP on github-callback:<ip>.
 *
 * @version v0.1.0
 */

import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { users } from "~/db/schema";
import { createGitHubClient, buildRedirectUri } from "~/lib/github-auth.server";
import { createSessionForUser, sessionCookieHeader, getCookieValue } from "~/sessions.server";
import { safeReturnTo } from "@ampl/kit/auth";
import { cloudflareContext } from "~/context";
import { logError } from "~/lib/logging.server";
import { BASENAME } from "~/lib/paths";
import type { Route } from "./+types/auth.callback";

// Cookie names — must match the initiation route in app/routes/auth.github.tsx.
const STATE_COOKIE = "github_oauth_state";
const RETURN_TO_COOKIE = "github_return_to";
// NOTE: NO VERIFIER_COOKIE — GitHub OAuth Apps are state-only.

/**
 * Builds Set-Cookie strings that delete the OAuth state + return_to cookies.
 * Mirrors the attribute set used by auth.github.tsx so the browser actually
 * drops the cookies. `Secure` only on HTTPS (dev-strip pattern).
 */
function clearOAuthCookies(isSecure: boolean): string[] {
  const secureAttr = isSecure ? "Secure; " : "";
  return [
    `${STATE_COOKIE}=; HttpOnly; ${secureAttr}SameSite=Lax; Max-Age=0; Path=${BASENAME}`,
    `${RETURN_TO_COOKIE}=; HttpOnly; ${secureAttr}SameSite=Lax; Max-Age=0; Path=${BASENAME}`,
  ];
}

/**
 * Builds a redirect Response with OAuth cookies cleared and a ?error= code
 * on the login page. Uses a BARE in-app path (no BASENAME) so it stays WITHIN
 * the /auth app — React Router re-prepends the basename exactly once. Prepending
 * BASENAME here too would double to /auth/auth/login → 500.
 * Throws (never returns) to break out of any caller.
 */
function rejectWithError(errorCode: string, isSecure: boolean): never {
  const headers = new Headers();
  for (const cookie of clearOAuthCookies(isSecure)) {
    headers.append("Set-Cookie", cookie);
  }
  // Bare path — RR prepends /auth once at runtime.
  throw redirect(`/login?error=${errorCode}`, { headers });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const isSecure = url.protocol === "https:";
  const cookieHeader = request.headers.get("Cookie");

  // ── GitHub-side error param ───────────────────────────────────────────────
  // User denied consent or GitHub returned an error — no `code` to exchange.
  const githubError = url.searchParams.get("error");
  if (githubError) {
    if (githubError === "access_denied") {
      rejectWithError("oauth-cancelled", isSecure);
    }
    rejectWithError("oauth-failed", isSecure);
  }

  // ── Rate limit ───────────────────────────────────────────────────────────
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success: withinLimit } = await env.AUTH_RATE_LIMITER.limit({
    key: `github-callback:${ip}`,
  });
  if (!withinLimit) {
    rejectWithError("rate-limited", isSecure);
  }

  // ── State validation (CSRF defence) ──────────────────────────────────────
  // Validates that the state in the URL matches the state stored in the cookie.
  // No code_verifier check — GitHub is state-only.
  const storedState = getCookieValue(cookieHeader, STATE_COOKIE);
  const urlState = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (!storedState || !urlState || storedState !== urlState || !code) {
    rejectWithError("state-mismatch", isSecure);
  }

  // ── Token exchange ────────────────────────────────────────────────────────
  // Secrets are provisioned via `wrangler secret put`; not auto-typed on Env.
  const secrets = env as unknown as {
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
  };
  if (!secrets.GITHUB_CLIENT_ID || !secrets.GITHUB_CLIENT_SECRET) {
    logError(new Error("GitHub OAuth secrets missing"), {
      action: "auth.callback.secrets",
    });
    rejectWithError("oauth-failed", isSecure);
  }

  const redirectUri = buildRedirectUri(request.url);
  const github = createGitHubClient(
    secrets.GITHUB_CLIENT_ID!,
    secrets.GITHUB_CLIENT_SECRET!,
    redirectUri,
  );

  let accessToken: string;
  try {
    // No verifier — state-only exchange.
    const tokens = await github.validateAuthorizationCode(code!);
    accessToken = tokens.accessToken();
  } catch (error) {
    logError(error, { action: "auth.callback.tokenExchange" });
    rejectWithError("oauth-failed", isSecure);
  }

  // ── GitHub REST identity fetch ───────────────────────────────────────────
  // MUST include User-Agent — Cloudflare Workers does not auto-set it (→ 403).
  const ghHeaders = {
    Authorization: `Bearer ${accessToken!}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ampl-auth",
  };

  let ghUser: { id: number; login: string; name: string | null; avatar_url: string };
  let ghEmails: Array<{ email: string; primary: boolean; verified: boolean }>;
  try {
    const [userRes, emailsRes] = await Promise.all([
      fetch("https://api.github.com/user", { headers: ghHeaders }),
      fetch("https://api.github.com/user/emails", { headers: ghHeaders }),
    ]);
    if (!userRes.ok || !emailsRes.ok) {
      rejectWithError("oauth-failed", isSecure);
    }
    ghUser = await userRes.json() as typeof ghUser;
    ghEmails = await emailsRes.json() as typeof ghEmails;
  } catch (error) {
    if (error instanceof Response) throw error;
    logError(error, { action: "auth.callback.githubFetch" });
    rejectWithError("oauth-failed", isSecure);
  }

  // ── Verified primary email gate ──────────────────────────────────────────
  const primaryEmail = ghEmails!.find(
    (e) => e.primary && e.verified,
  );
  if (!primaryEmail) {
    rejectWithError("no-verified-email", isSecure);
  }

  // ── Upsert-by-github_id ──────────────────────────────────────────────────
  // SELECT first; INSERT when absent, UPDATE profile + lastSeenAt when present.
  // The unique index on github_id prevents duplicates at the DB level.
  const db = drizzle(env.AUTH_DB, { schema });
  const now = Date.now();
  const email = primaryEmail!.email.toLowerCase();

  let user = await db
    .select()
    .from(users)
    .where(eq(users.githubId, ghUser!.id))
    .get();

  if (!user) {
    // New user — INSERT
    const [inserted] = await db
      .insert(users)
      .values({
        githubId: ghUser!.id,
        email,
        handle: ghUser!.login,
        name: ghUser!.name ?? null,
        avatarUrl: ghUser!.avatar_url,
        createdAt: now,
        lastSeenAt: now,
      })
      .returning();
    user = inserted;
  } else {
    // Returning user — UPDATE profile + lastSeenAt (profile refresh on login)
    await db
      .update(users)
      .set({
        handle: ghUser!.login,
        name: ghUser!.name ?? null,
        avatarUrl: ghUser!.avatar_url,
        email,
        lastSeenAt: now,
      })
      .where(eq(users.githubId, ghUser!.id));
  }

  // ── Session creation + redirect ───────────────────────────────────────────
  const created = await createSessionForUser(db, user!.id);

  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookieHeader(created.rawCookieValue, isSecure));
  for (const cookie of clearOAuthCookies(isSecure)) {
    headers.append("Set-Cookie", cookie);
  }

  // ABSOLUTE URL redirect to bypass RR v7 basename prepend.
  // A relative redirect("/palaeography/...") would become /auth/palaeography/...
  // because the router applies the /auth basename.
  // decodeURIComponent throws URIError on malformed percent-encoding
  // (e.g. a tampered `%zz` cookie). This runs AFTER the session row is created,
  // so an unguarded throw would 500 an already-authenticated user. Fall back to
  // "" (→ safeReturnTo → "/" → the /auth default) instead of erroring.
  let rawReturnTo = "";
  try {
    rawReturnTo = decodeURIComponent(
      getCookieValue(cookieHeader, RETURN_TO_COOKIE) ?? "",
    );
  } catch {
    rawReturnTo = "";
  }
  const returnTo = safeReturnTo(rawReturnTo); // guards open-redirect
  const origin = url.origin;
  const destination =
    returnTo === "/"
      ? new URL(BASENAME, origin).toString()  // → https://ampl.tools/auth
      : new URL(returnTo, origin).toString(); // → https://ampl.tools/palaeography/...

  throw redirect(destination, { headers });
}
