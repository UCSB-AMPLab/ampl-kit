/**
 * Site header
 *
 * This file provides the minimal header shell shared across AMPL tools. It is
 * intentionally an empty frame with three slots rather than a finished header:
 * one slot for a tool's own logo or wordmark lockup, one for an optional nav
 * row, and one for the language switcher. The header never owns a logo asset,
 * nav links, or wires up the switcher itself — the consuming app supplies all
 * three as ready-made nodes — which keeps the shared kit free of tool-specific
 * dependencies and adds no navigation links of its own. The layout is a
 * two-column grid capped at 1200px wide with generous vertical padding, and the
 * lockup column grows with the viewport (up to 300px, then 400px on large
 * screens and 500px on extra-large).
 *
 * When the optional `nav` slot is absent the right column renders identically
 * to v0.1.0 — the localeSwitcher is placed directly inside the justify-self-end
 * wrapper with no extra markup — so existing consumers (Calamus) are unaffected.
 *
 * @version v0.2.0
 */

type SiteHeaderProps = {
  /** Lockup slot — the tool provides its own logo/wordmark inside a link. */
  children?: React.ReactNode;
  /** Locale switcher slot — pass a pre-wired <LocaleSwitcher buildHref=.. current=.. />. */
  localeSwitcher?: React.ReactNode;
  /** Optional nav slot. When present, renders above localeSwitcher in the right column. When absent, the header renders exactly as before (backward compatible). */
  nav?: React.ReactNode;
};

export function SiteHeader({ children, localeSwitcher, nav }: SiteHeaderProps) {
  return (
    <header className="py-10 md:py-16">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[auto_1fr] items-center gap-6 px-[30px]">
        <div className="block w-full max-w-[300px] lg:max-w-[400px] xl:max-w-[500px]">
          {children}
        </div>
        <div className="justify-self-end">
          {nav ? (
            <div className="flex flex-col items-end gap-2">
              {nav}
              {localeSwitcher}
            </div>
          ) : (
            localeSwitcher
          )}
        </div>
      </div>
    </header>
  );
}
