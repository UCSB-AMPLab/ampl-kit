/**
 * Unsubscribe handler — GET/POST /email/unsubscribe
 *
 * This file handles the RFC 8058 one-click unsubscribe flow:
 *   GET  /email/unsubscribe?token=…  — bilingual confirmation page
 *   POST /email/unsubscribe          — HMAC-verified address suppression
 *
 * Both methods rate-limit by IP first (EMAIL_RATE_LIMITER).
 *
 * GET: Renders a plain bilingual HTML page (EN + ES) explaining that
 * unsubscribing stops ALL AMPL transactional mail (global suppression).
 * No scripts, no nonces — a static page with a POST form/button. Five
 * security headers applied.
 *
 * POST: Reads the token from the form body (application/x-www-form-urlencoded)
 * or from the query string (RFC 8058 one-click POST), calls verifyUnsubToken(),
 * and on success inserts a suppressions row (reason "unsubscribe", source
 * "user_request"). Uses insert-or-ignore semantics — a repeat POST for an
 * already-suppressed address succeeds with 200.
 *
 * @version v0.1.0
 */

import { verifyUnsubToken } from "../lib/unsub-token";
import { getEmailDb, schema } from "../db/client.email";
import { normalizeEmail } from "../lib/suppression";
import { logError } from "../../lib/logging.server";

// ---------------------------------------------------------------------------
// Bilingual copy
//
// These strings mirror the kit/locales `email.unsubscribe.*` keys. They are
// inlined here so the handler has no runtime dependency on the i18next bundle.
// Any change must be kept in lockstep with kit/locales.
// ---------------------------------------------------------------------------

const COPY = {
  en: {
    title: "Unsubscribe from AMPL emails",
    heading: "Unsubscribe",
    explain:
      "Confirming will remove this address from all AMPL transactional mail. This is a global action — you will no longer receive automated messages from any AMPL tool (Calamus, Scheduling, or any future tool).",
    button: "Confirm unsubscribe",
    confirmedHeading: "You have been unsubscribed",
    confirmedBody:
      "Your address has been removed from our list. You will no longer receive transactional emails from any AMPL tool.",
    tagline: "Archives, Memory, and Preservation Lab · UC Santa Barbara",
  },
  es: {
    title: "Darte de baja de los correos de AMPL",
    heading: "Darte de baja",
    explain:
      "Al confirmar, esta dirección quedará excluida de todos los mensajes automáticos de AMPL. La exclusión es global: cubre todas las herramientas —Calamus, Scheduling y las que vengan más adelante—, no solo la que te envió este mensaje.",
    button: "Confirmar baja",
    confirmedHeading: "Te has dado de baja",
    confirmedBody:
      "Hemos quitado tu dirección de nuestra lista. Ya no recibirás mensajes automáticos de ninguna herramienta de AMPL.",
    tagline: "Archives, Memory, and Preservation Lab · UC Santa Barbara",
  },
} as const;

// ---------------------------------------------------------------------------
// Security headers applied to every HTML response from this handler
// ---------------------------------------------------------------------------

function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // CSP: no scripts, no inline styles loaded from external origins.
  // No nonce needed — the page has no scripts and no dynamic styles.
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

/**
 * Build a bilingual (EN + ES) unsubscribe confirmation page.
 *
 * The page shows EN content followed by an ES section, so both language markers
 * are always present in the HTML.
 */
function buildBilingualConfirmationPage(token: string): string {
  const en = COPY.en;
  const es = COPY.es;
  const safeToken = token.replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${en.title} / ${es.title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 48px auto; padding: 0 16px; color: #111827; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #374151; line-height: 1.6; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    .lab { font-size: 0.875rem; color: #6b7280; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    button { background: #111827; color: #fff; border: none; padding: 10px 20px; font-size: 1rem; border-radius: 4px; cursor: pointer; }
    button:hover { background: #374151; }
  </style>
</head>
<body>
  <section lang="en">
    <h1>${en.heading}</h1>
    <p>${en.explain}</p>
    <form method="POST" action="/email/unsubscribe">
      <input type="hidden" name="token" value="${safeToken}">
      <button type="submit">${en.button}</button>
    </form>
  </section>
  <hr class="divider">
  <section lang="es">
    <h1>${es.heading}</h1>
    <p>${es.explain}</p>
  </section>
  <p class="lab">${en.tagline}</p>
</body>
</html>`;
}

/**
 * Build a bilingual (EN + ES) unsubscribe confirmed page (POST success state).
 */
function buildBilingualConfirmedPage(): string {
  const en = COPY.en;
  const es = COPY.es;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${en.title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 48px auto; padding: 0 16px; color: #111827; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #374151; line-height: 1.6; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    .lab { font-size: 0.875rem; color: #6b7280; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  </style>
</head>
<body>
  <section lang="en">
    <h1>${en.confirmedHeading}</h1>
    <p>${en.confirmedBody}</p>
  </section>
  <hr class="divider">
  <section lang="es">
    <h1>${es.confirmedHeading}</h1>
    <p>${es.confirmedBody}</p>
  </section>
  <p class="lab">${en.tagline}</p>
</body>
</html>`;
}

function buildConfirmationPage(token: string, locale: "en" | "es"): string {
  const c = COPY[locale];
  // Escape the token for safe inline use in the form value
  const safeToken = token.replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${c.title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 48px auto; padding: 0 16px; color: #111827; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #374151; line-height: 1.6; }
    .lab { font-size: 0.875rem; color: #6b7280; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    button { background: #111827; color: #fff; border: none; padding: 10px 20px; font-size: 1rem; border-radius: 4px; cursor: pointer; }
    button:hover { background: #374151; }
  </style>
</head>
<body>
  <h1>${c.heading}</h1>
  <p>${c.explain}</p>
  <form method="POST" action="/email/unsubscribe">
    <input type="hidden" name="token" value="${safeToken}">
    <button type="submit">${c.button}</button>
  </form>
  <p class="lab">${c.tagline}</p>
</body>
</html>`;
}

function buildConfirmedPage(locale: "en" | "es"): string {
  const c = COPY[locale];
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${c.title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 48px auto; padding: 0 16px; color: #111827; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #374151; line-height: 1.6; }
    .lab { font-size: 0.875rem; color: #6b7280; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>${c.confirmedHeading}</h1>
  <p>${c.confirmedBody}</p>
  <p class="lab">${c.tagline}</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle GET and POST /email/unsubscribe requests.
 *
 * @param request - the incoming Request
 * @param env     - the Worker's Env bindings
 */
export async function handleUnsubscribe(
  request: Request,
  env: Env,
): Promise<Response> {
  // 1. Per-IP rate limit (both GET and POST)
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const limiter = await env.EMAIL_RATE_LIMITER.limit({ key: ip });
  if (!limiter.success) {
    return new Response("Too Many Requests", { status: 429 });
  }

  const url = new URL(request.url);
  // Detect locale from Accept-Language header; default to "en"
  const acceptLang = request.headers.get("Accept-Language") ?? "";
  const locale: "en" | "es" = acceptLang.toLowerCase().startsWith("es")
    ? "es"
    : "en";

  // -------------------------------------------------------------------------
  // GET — render bilingual confirmation page (always EN + ES)
  // -------------------------------------------------------------------------
  if (request.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    const html = buildBilingualConfirmationPage(token);
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
    });
    applySecurityHeaders(headers);
    return new Response(html, { status: 200, headers });
  }

  // -------------------------------------------------------------------------
  // POST — verify token and suppress address
  // -------------------------------------------------------------------------
  if (request.method === "POST") {
    try {
      // Read token from form body or query string
      let token = url.searchParams.get("token") ?? "";
      if (!token) {
        const contentType = request.headers.get("Content-Type") ?? "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const body = await request.text();
          const params = new URLSearchParams(body);
          token = params.get("token") ?? "";
        }
      }

      if (!token) {
        return new Response("Bad Request: missing token", { status: 400 });
      }

      // Verify the HMAC token — returns null if invalid. The secret is
      // provisioned via `wrangler secret put`; not auto-typed on Env.
      const { UNSUB_HMAC_SECRET } = env as unknown as {
        UNSUB_HMAC_SECRET?: string;
      };
      // Fail closed on a misconfigured environment: an unset secret must reject
      // the request (server error) rather than verify the token under an empty
      // HMAC key.
      if (!UNSUB_HMAC_SECRET) {
        logError(new Error("UNSUB_HMAC_SECRET missing"), {
          action: "email.unsubscribe.secret",
        });
        return new Response("Internal Server Error", { status: 500 });
      }
      const address = await verifyUnsubToken(token, UNSUB_HMAC_SECRET);
      if (!address) {
        return new Response("Forbidden: invalid token", { status: 403 });
      }

      // Insert suppression — insert-or-ignore for repeat POST
      const db = getEmailDb(env);
      try {
        await db.insert(schema.suppressions).values({
          address: normalizeEmail(address),
          reason: "unsubscribe",
          source: "user_request",
          createdAt: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const causeMsg =
          err instanceof Error && err.cause instanceof Error
            ? err.cause.message
            : "";
        const isUnique =
          msg.includes("UNIQUE constraint failed") ||
          causeMsg.includes("UNIQUE constraint failed");
        if (!isUnique) throw err;
        // Already suppressed — not an error
      }

      const html = buildBilingualConfirmedPage();
      const headers = new Headers({
        "Content-Type": "text/html; charset=utf-8",
      });
      applySecurityHeaders(headers);
      return new Response(html, { status: 200, headers });
    } catch (error) {
      logError(error, { action: "email.unsubscribe" });
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // Method not allowed
  return new Response("Method Not Allowed", { status: 405 });
}
