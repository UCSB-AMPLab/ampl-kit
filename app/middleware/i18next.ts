/**
 * Server-side language detection middleware
 *
 * This file decides which language each request is served in, and exposes the
 * tools the rest of the app uses to read that decision. It defines the `lng`
 * cookie — deliberately scoped to the `/auth` base path so it is not shared
 * with sibling tools on the apex — which the locale-switch route writes and
 * this detection middleware reads. From that cookie (falling back to English)
 * it builds the per-request i18next instance, loading both this app's `common`
 * strings and the shared `kit` strings, and hands back the middleware plus the
 * `getLocale`/`getInstance` accessors that loaders and the root layout call.
 *
 * @version v0.1.0
 */

import { initReactI18next } from "react-i18next";
import { createCookie } from "react-router";
import { createI18nextMiddleware } from "remix-i18next/middleware";
import resources from "~/locales";
import { BASENAME } from "~/lib/paths";

export const localeCookie = createCookie("lng", {
  // Path-scoped to the basename so the locale cookie isn't shared with sibling
  // tools on the ampl.tools apex. WRITTEN by app/routes/locale.tsx (the
  // locale-switch resource route); READ here by the i18next detection middleware.
  // No client-side write exists.
  path: BASENAME,
  sameSite: "lax",
  secure: import.meta.env.PROD,
  httpOnly: false, // Client needs read for inline lang script
  maxAge: 365 * 24 * 60 * 60, // 1 year — matches theme-preference pattern
});

export const [i18nextMiddleware, getLocale, getInstance] =
  createI18nextMiddleware({
    detection: {
      supportedLanguages: ["en", "es"],
      fallbackLanguage: "en",
      cookie: localeCookie,
    },
    i18next: {
      resources,
      defaultNS: "common",
      ns: ["common", "kit"],
      interpolation: { escapeValue: false },
    },
    plugins: [initReactI18next],
  });
