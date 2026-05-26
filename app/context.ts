/**
 * Request-scoped context keys
 *
 * This file defines the typed "slots" that travel alongside each request as it
 * moves through middleware, loaders, and actions. There are two: one carries
 * the Cloudflare `env` and execution context — the gateway to the D1 database,
 * secrets, and the rate limiter — set once by the Worker entry point; the other
 * carries the authenticated user, or `null` when the request is anonymous.
 * Downstream code reads these slots instead of threading globals around, which
 * keeps the database binding and the signed-in user discoverable from anywhere
 * in the request flow.
 *
 * @version v0.1.0
 */

import { createContext } from "react-router";
import type { AuthenticatedUser } from "@ampl/kit/auth";

export const cloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();

/**
 * The shape of the authenticated user attached to the request context after
 * the auth middleware resolves a session cookie to a `users` row.
 *
 * Single-sourced from @ampl/kit/auth — no local copy.
 */
export type { AuthenticatedUser } from "@ampl/kit/auth";

/**
 * Per-request user context — `null` when the request is unauthenticated.
 * The auth middleware overwrites this with a real user on protected
 * routes; downstream loaders/actions narrow with `if (user)` before use.
 */
export const userContext = createContext<AuthenticatedUser | null>(null);
