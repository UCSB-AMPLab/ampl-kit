/**
 * Email sign-in: request a link
 *
 * This file handles the POST from the email form on the sign-in page. It is
 * action-only, so a GET answers 405. The checks that can run without knowing
 * whether the address belongs to anyone run here, in order: the feature flag,
 * the same-origin check, the per-IP rate limit, the address syntax, the domain
 * allow-list, and Turnstile. A failure sends the person back to the sign-in
 * page with an error code; the domain policy is public, so a refused domain
 * gets an explicit message.
 *
 * Once those pass, every allowed address gets the same redirect to the "check
 * your email" page. The work that depends on the address (the per-address
 * limit, the hourly cap, the account lookup, the token, the send) is handed
 * to ctx.waitUntil, so the response neither differs nor waits for it.
 *
 * Threat-model linkages:
 *   - CSRF: Origin / Sec-Fetch-Site check (isSameOriginPost).
 *   - Enumeration: identical response and timing for known and unknown
 *     allowed addresses; address-dependent work runs after the response.
 *   - Flood / bots: AUTH_RATE_LIMITER per IP here and per address in the
 *     background, an hourly cap in D1, and Turnstile.
 *   - Open redirect: return_to goes through safeReturnTo before it is stored.
 *
 * @version v0.4.0
 */

import { redirect } from "react-router";
import { safeReturnTo } from "@ampl/kit/auth";
import { cloudflareContext } from "~/context";
import { getLocale } from "~/middleware/i18next";
import {
  emailLoginConfig,
  isAllowedDomain,
  isPlausibleEmail,
  isSameOriginPost,
  normalizeEmail,
  processEmailRequest,
  turnstileExpectation,
  verifyTurnstile,
  type Locale,
} from "~/lib/email-login.server";
import { logError } from "~/lib/logging.server";
import type { Route } from "./+types/auth.email.request";

/** Back to the sign-in page with an error code; keeps a valid return_to. */
function backToLogin(error: string, returnTo: string): never {
  const params = new URLSearchParams({ error });
  if (returnTo !== "/") params.set("return_to", returnTo);
  // Bare in-app path: React Router prepends the /auth basename once.
  throw redirect(`/login?${params.toString()}`);
}

function requestLocale(context: Route.ActionArgs["context"]): Locale {
  try {
    return getLocale(context) === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const config = emailLoginConfig(env);

  if (!config.enabled) throw new Response("Not Found", { status: 404 });
  if (!isSameOriginPost(request, config.appOrigin)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const ip = request.headers.get("CF-Connecting-IP");
  const { success } = await env.AUTH_RATE_LIMITER.limit({
    key: `email-request:${ip ?? "unknown"}`,
  });

  const form = await request.formData();
  const rawReturnTo = form.get("return_to");
  const returnTo = safeReturnTo(typeof rawReturnTo === "string" ? rawReturnTo : null);
  if (!success) backToLogin("rate-limited", returnTo);

  if (!config.turnstileSecret || !config.turnstileSiteKey) {
    logError(new Error("Turnstile keys missing"), { action: "email.request.config" });
    backToLogin("email-unavailable", returnTo);
  }

  const rawEmail = form.get("email");
  const email = normalizeEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!isPlausibleEmail(email)) backToLogin("email-invalid", returnTo);
  if (!isAllowedDomain(email, config.domains)) backToLogin("email-domain", returnTo);

  const turnstile = form.get("cf-turnstile-response");
  const human = await verifyTurnstile(
    config.turnstileSecret,
    typeof turnstile === "string" ? turnstile : "",
    ip,
    turnstileExpectation(config),
  );
  if (!human) backToLogin("turnstile-failed", returnTo);

  ctx.waitUntil(
    processEmailRequest(env, { email, returnTo, locale: requestLocale(context) }),
  );
  throw redirect("/email/sent");
}
