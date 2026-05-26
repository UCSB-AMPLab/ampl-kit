/**
 * Browser entry point
 *
 * This file is the first code that runs in the visitor's browser. Before React
 * takes over the server-rendered page, it sets up i18next so translations work
 * the moment the app comes alive — reading the chosen language straight from
 * the `<html lang>` attribute the server already set, rather than guessing or
 * re-detecting, so the client and server agree. Once translations are ready it
 * hydrates the existing markup, attaching React's event handlers to the page
 * the server sent without re-rendering it from scratch.
 *
 * @version v0.1.0
 */

import i18next from "i18next";
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { HydratedRouter } from "react-router/dom";
import I18nextBrowserLanguageDetector from "i18next-browser-languagedetector";
import resources from "~/locales";

async function main() {
  // Initialise i18next before hydration so useTranslation() works immediately.
  // initReactI18next binds the instance to React context globally —
  // no I18nextProvider wrapper needed on the client.
  await i18next
    .use(initReactI18next)
    .use(I18nextBrowserLanguageDetector)
    .init({
      resources,
      defaultNS: "common",
      fallbackLng: "en",
      supportedLngs: ["en", "es"],
      interpolation: { escapeValue: false },
      detection: {
        order: ["htmlTag"], // Read from <html lang> set by server
        caches: [], // Don't cache — server is source of truth
      },
    });

  startTransition(() => {
    hydrateRoot(document, <HydratedRouter />);
  });
}

main().catch(console.error);
