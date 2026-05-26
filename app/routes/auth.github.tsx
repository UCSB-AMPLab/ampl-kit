/**
 * GitHub OAuth initiation
 *
 * This file handles the first half of signing in with GitHub. When a user
 * chooses "Continue with GitHub", this route generates a fresh anti-forgery
 * `state` value, remembers where the user was heading in a short-lived cookie,
 * and redirects them to GitHub's authorization page asking only for their
 * identity — their profile and email. The `state` and return-destination are
 * stashed in 10-minute HttpOnly cookies so the callback route can verify the
 * round-trip and send the user onward. It is loader-only — it renders no UI —
 * and a per-IP rate limit guards the entry point against flooding.
 *
 * Implementation notes:
 *   1. Uses arctic.GitHub (no PKCE — GitHub OAuth Apps are state-only).
 *   2. Secrets narrowed to GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET.
 *   3. State cookie + return_to cookie emitted instead of state + code_verifier
 *      (return_to carried in a short-lived HttpOnly cookie at initiation).
 *   4. Rate-limit guard (key: github-initiate:<ip>).
 *
 * Flow:
 *   1. Rate-limit check — rejects flooding.
 *   2. Generate fresh state (arctic; no code verifier needed for GitHub).
 *   3. Build the per-environment redirect URI from the request origin.
 *   4. Construct the GitHub authorisation URL with identity-only scopes
 *      read:user + user:email; NO code_challenge, NO prompt param.
 *   5. Emit two short-lived (Max-Age=600 / 10-minute) HttpOnly SameSite=Lax
 *      cookies: github_oauth_state (CSRF guard) + github_return_to.
 *   6. 302-redirect to github.com/login/oauth/authorize.
 *
 * @version v0.1.0
 */

import { redirect } from "react-router";
import { createGitHubClient, buildRedirectUri, generateState } from "~/lib/github-auth.server";
import { cloudflareContext } from "~/context";
import { logError } from "~/lib/logging.server";
import { BASENAME } from "~/lib/paths";
import type { Route } from "./+types/auth.github";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  // Rate-limit — before any secrets access.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.AUTH_RATE_LIMITER.limit({ key: `github-initiate:${ip}` });
  // Bare in-app path: RR re-prepends the basename once (BASENAME + would double it).
  if (!success) throw redirect("/login?error=rate-limited");

  // Narrow secrets — provisioned via `wrangler secret put`, not in wrangler.jsonc vars.
  const secrets = env as unknown as {
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
  };
  if (!secrets.GITHUB_CLIENT_ID || !secrets.GITHUB_CLIENT_SECRET) {
    // Mirror the callback's clean logged-redirect instead of throwing a
    // raw 500. A misconfigured environment lands the user on the login page
    // with a surfaced error code rather than an opaque server error.
    logError(new Error("GitHub OAuth secrets missing"), {
      action: "auth.github.secrets",
    });
    throw redirect("/login?error=oauth-failed");
  }

  const state = generateState();
  const redirectUri = buildRedirectUri(request.url);
  const returnTo = new URL(request.url).searchParams.get("return_to") ?? "";

  const github = createGitHubClient(
    secrets.GITHUB_CLIENT_ID,
    secrets.GITHUB_CLIENT_SECRET,
    redirectUri,
  );

  // State-only authorization URL — NO code_challenge, NO code_verifier, NO prompt.
  const url = github.createAuthorizationURL(state, ["read:user", "user:email"]);

  // Browsers reject `Secure` cookies on HTTP — drop the attribute on
  // wrangler-dev's localhost (sessions dev-strip).
  const isSecure = new URL(request.url).protocol === "https:";
  const secureAttr = isSecure ? "Secure; " : "";

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `github_oauth_state=${state}; HttpOnly; ${secureAttr}SameSite=Lax; Max-Age=600; Path=${BASENAME}`,
  );
  // return_to carried in a short-lived HttpOnly cookie at initiation.
  // Path=${BASENAME} (/auth) — short-lived OAuth cookies, not the session cookie.
  headers.append(
    "Set-Cookie",
    `github_return_to=${encodeURIComponent(returnTo)}; HttpOnly; ${secureAttr}SameSite=Lax; Max-Age=600; Path=${BASENAME}`,
  );

  throw redirect(url.toString(), { headers });
}
