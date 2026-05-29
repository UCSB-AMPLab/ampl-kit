/**
 * Compliance footer builder
 *
 * This file builds the bilingual compliance footer appended to every outbound
 * email inside `send()`. The footer always contains:
 *   - A stable HTML comment marker (`<!--ampl-footer-->`) so tests can assert
 *     footer presence via substring search
 *   - The unsubscribe URL (signed token, built by the caller)
 *
 * The bilingual EN/ES copy is sourced from the `email.footer.*` i18n keys and
 * inlined here so `buildFooter` has no runtime dependency on the i18next bundle
 * (email is sent server-side without the browser i18n stack).
 *
 * The footer is stamped INSIDE `send()` — the caller cannot opt out. This
 * ensures every delivered email complies with RFC 8058 and CAN-SPAM hygiene
 * requirements.
 *
 * @version v0.2.0
 */

/**
 * Bilingual compliance-footer copy.
 *
 * These strings are sourced from kit/locales/en.ts and kit/locales/es.ts under
 * the `email.footer.*` keys. They are inlined here so `buildFooter` has no
 * runtime dependency on the i18next bundle (email is sent server-side without
 * the browser i18n stack). Any change to these strings must be made in both
 * places to keep kit/locales and this copy in lockstep.
 */
const FOOTER_COPY = {
  en: {
    transactional: "This is an automated transactional message from AMPL.",
    tagline: "Archives, Memory, and Preservation Lab · UC Santa Barbara",
    unsubscribeLabel: "Unsubscribe",
  },
  es: {
    transactional: "Este es un mensaje transaccional automático de AMPL.",
    tagline: "Archives, Memory, and Preservation Lab · UC Santa Barbara",
    unsubscribeLabel: "Darte de baja",
  },
} as const;

/**
 * Build the compliance footer for a given locale and unsubscribe URL.
 *
 * Returns both an HTML variant (for the `html` body) and a plain-text variant
 * (for the `text` body). Both contain the stable `<!--ampl-footer-->` marker
 * and the unsubscribe URL. EN/ES keys live in kit/locales under
 * `email.footer.*`.
 *
 * @param locale    - "en" or "es" (defaults to "en" in `send()` when absent)
 * @param unsubUrl  - the full unsubscribe URL including signed token
 * @returns `{ html: string, text: string }` footer fragments
 */
export function buildFooter(
  locale: "en" | "es",
  unsubUrl: string,
): { html: string; text: string } {
  const copy = FOOTER_COPY[locale];

  const html = [
    "<!--ampl-footer-->",
    `<div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;color:#6b7280;">`,
    `<p>${copy.transactional}</p>`,
    `<p>${copy.tagline}</p>`,
    `<p><a href="${unsubUrl}">${copy.unsubscribeLabel}</a></p>`,
    `</div>`,
  ].join("\n");

  const text = [
    "---",
    copy.transactional,
    copy.tagline,
    `${copy.unsubscribeLabel}: ${unsubUrl}`,
  ].join("\n");

  return { html, text };
}
