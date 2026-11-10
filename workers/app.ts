/**
 * Worker entry point
 *
 * This file is the very first code that runs for every request to
 * `ampl.tools/auth`. It hands the request to React Router's server-side
 * request handler — wiring in the Cloudflare `env` and execution context so
 * loaders and actions can reach the D1 database, secrets, and the rate
 * limiter — then stamps a baseline of security headers onto every response:
 * clickjacking protection (`X-Frame-Options`), HTTPS enforcement (HSTS),
 * MIME-sniffing protection, and a no-referrer policy.
 *
 * @version v0.4.0
 */

import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    const response = await requestHandler(request, context);
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
    response.headers.set("X-Content-Type-Options", "nosniff");
    // no-referrer, matching securityMiddleware: a sign-in link carries its
    // token in the URL, so no response may let the URL leak in a Referer.
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  },
} satisfies ExportedHandler<Env>;
