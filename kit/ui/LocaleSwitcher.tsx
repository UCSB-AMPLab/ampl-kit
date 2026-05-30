import { useTranslation } from "react-i18next";

/**
 * Locale switcher
 *
 * This file renders the little "EN / ES" control that lets a visitor switch the
 * interface language. It draws two plain links and marks the active one for
 * assistive technology. To stay usable in every AMPL tool regardless of how
 * that tool is mounted or routed, it never builds the switch URLs itself —
 * instead the consuming app supplies a `buildHref` function that turns a target
 * language into the right link. That keeps this component free of any routing
 * dependency.
 *
 * Usage:
 *   const buildHref = (lng: "en" | "es") =>
 *     `${withBase("/locale")}?lng=${lng}&to=...`;
 *   <LocaleSwitcher buildHref={buildHref} current={current} />
 *   <LocaleSwitcher buildHref={buildHref} current={current} variant="on-dark" />  // plum band
 *
 * @version v0.1.1
 */

type LocaleSwitcherProps = {
  /** Given a target locale, return the full href for the locale-switch link. */
  buildHref: (lng: "en" | "es") => string;
  /** The currently active locale. */
  current: "en" | "es";
  /** Visual theme. "on-dark" is for the plum WORKSHOP band; default is light. */
  variant?: "default" | "on-dark";
};

export function LocaleSwitcher({ buildHref, current, variant = "default" }: LocaleSwitcherProps) {
  const { t } = useTranslation("kit");
  const onDark = variant === "on-dark";
  const activeCls = onDark ? "font-semibold text-white" : "font-semibold text-fg-1";
  const idleCls = onDark ? "text-white/60 hover:text-white" : "text-fg-3 hover:text-accent";
  const slashCls = onDark ? "text-white/30" : "text-fg-3 opacity-60";

  return (
    <div
      className="inline-flex items-center gap-1.5 font-body text-[13px] uppercase tracking-[0.5px]"
      aria-label={t("header.localeLabel")}
    >
      <a href={buildHref("en")} aria-current={current === "en" ? "true" : undefined}
        className={current === "en" ? activeCls : idleCls}>EN</a>
      <span className={slashCls} aria-hidden="true">/</span>
      <a href={buildHref("es")} aria-current={current === "es" ? "true" : undefined}
        className={current === "es" ? activeCls : idleCls}>ES</a>
    </div>
  );
}
