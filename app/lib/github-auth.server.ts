/**
 * GitHub OAuth helpers
 *
 * This file holds the small, shared pieces the two OAuth routes lean on. It
 * builds an Arctic GitHub client from the app's credentials — created fresh per
 * request because those credentials come from the Cloudflare `env` — and it
 * computes the `redirect_uri` that GitHub sends users back to, anchored to the
 * `/auth/callback` path on whatever origin the request arrived at, so it works
 * the same in development and production. It deliberately deals in GitHub's
 * state-only OAuth App model: there is no PKCE code verifier and no OIDC
 * id-token here, because GitHub OAuth Apps protect the token exchange with the
 * client secret instead.
 *
 * @version v0.1.0
 */

import * as arctic from "arctic";
import { withBase } from "~/lib/paths";

/**
 * Creates an Arctic GitHub OAuth client.
 * Called per-request because credentials come from env.
 *
 * Uses `arctic.GitHub` — no PKCE, no code-verifier.
 * GitHub OAuth Apps use client-secret to protect the token exchange;
 * `createAuthorizationURL(state, scopes)` takes no verifier argument.
 */
export function createGitHubClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
) {
  return new arctic.GitHub(clientId, clientSecret, redirectUri);
}

/**
 * Builds the GitHub OAuth redirect URI from the current request origin.
 * Targets `/auth/callback` (the callback route inside this app's /auth basename).
 * The result must match an authorized redirect URI in the GitHub OAuth App.
 */
export function buildRedirectUri(requestUrl: string): string {
  return new URL(
    withBase("/callback"),
    new URL(requestUrl).origin,
  ).toString();
}

export const generateState = arctic.generateState;
// NOTE: NO generateCodeVerifier — GitHub state-only, no PKCE
// NOTE: NO decodeIdToken — GitHub is not OIDC, no id-token
