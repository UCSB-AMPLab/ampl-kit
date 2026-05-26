/**
 * Content-Security-Policy middleware
 *
 * This file hardens every HTML response against script-injection attacks. At
 * the start of each request it generates a fresh, unguessable nonce and stashes
 * it in the request context; after the page renders, it attaches a
 * Content-Security-Policy header that only trusts scripts carrying that exact
 * nonce, locks resources down to the app's own origin plus the specific font,
 * style, and avatar hosts the UI needs, and forbids the page from being framed.
 * The nonce it sets here is the same one the root loader and the server-render
 * entry point read, so the scripts React emits are allow-listed end to end.
 *
 * @version v0.1.0
 */

import { createContext } from "react-router";
import type { MiddlewareFunction } from "react-router";

/**
 * Typed middleware context for the CSP nonce.
 * Set by securityMiddleware, consumed by root loader and entry.server.tsx.
 */
export const nonceContext = createContext<string>();

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

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);

  return response;
};
