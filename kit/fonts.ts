/**
 * Design-system font links
 *
 * This file lists the three typefaces the AMPL look depends on — Ubuntu Mono
 * for body text, Roboto Slab for titles, and Silkscreen for display lettering —
 * as ready-to-use `<link>` descriptors. A tool spreads these into its document
 * `<head>` so the fonts load over the network in a way that does not block the
 * page from rendering, rather than being pulled in through a slower CSS import.
 *
 * @version v0.1.0
 */

/** Link descriptors for the three AMPL families (Google Fonts). */
export const kitFontLinks = [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" as const },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=Roboto+Slab:wght@100..900&family=Ubuntu+Mono:wght@400;700&display=swap",
  },
];
