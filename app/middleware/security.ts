/**
 * Content-Security-Policy middleware
 *
 * This file hardens every HTML response against script-injection attacks. At
 * the start of each request it generates a fresh, unguessable nonce and stashes
 * it in the request context; after the page renders, it attaches a
 * Content-Security-Policy header that only trusts scripts carrying that exact
 * nonce, locks resources down to the app's own origin plus the specific font,
 * style, avatar, and Turnstile hosts the UI needs, and forbids the page from
 * being framed. It also sets `Referrer-Policy: no-referrer`.
 * The nonce it sets here is the same one the root loader and the server-render
 * entry point read, so the scripts React emits are allow-listed end to end.
 *
 * @version v0.4.0
 */

import { createContext } from "react-router";
import type { MiddlewareFunction } from "react-router";

/**
 * Typed middleware context for the CSP nonce.
 * Set by securityMiddleware, consumed by root loader and entry.server.tsx.
 */
export const nonceContext = createContext<string>();

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Security middleware that generates a per-request CSP nonce
 * and sets Content-Security-Policy headers on the response.
 */
export const securityMiddleware: MiddlewareFunction<Response> = async (
  { context },
  next
) => {
  const nonce = crypto.randomUUID();
  context.set(nonceContext, nonce);

  const response = await next();

  // Turnstile (the email sign-in form) loads its script and renders its
  // challenge in an iframe from challenges.cloudflare.com. Under
  // 'strict-dynamic' the host entry in script-src is ignored by browsers that
  // honor the nonce, which the Turnstile <script> tag carries; it stays for
  // browsers that do not.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE_ORIGIN}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "connect-src 'self'",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "frame-ancestors 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);
  // A sign-in link carries its token in the URL; no page here may send its
  // URL to anyone in a Referer header.
  response.headers.set("Referrer-Policy", "no-referrer");

  return response;
};
