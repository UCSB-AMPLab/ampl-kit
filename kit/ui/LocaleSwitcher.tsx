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
 *
 * @version v0.1.0
 */

type LocaleSwitcherProps = {
  /** Given a target locale, return the full href for the locale-switch link. */
  buildHref: (lng: "en" | "es") => string;
  /** The currently active locale. */
  current: "en" | "es";
};

export function LocaleSwitcher({ buildHref, current }: LocaleSwitcherProps) {
  const { t } = useTranslation("kit");

  return (
    <div
      className="inline-flex items-center gap-1.5 font-title text-[13px] uppercase tracking-[0.6px]"
      aria-label={t("header.localeLabel")}
    >
      <a
        href={buildHref("en")}
        aria-current={current === "en" ? "true" : undefined}
        className={
          current === "en"
            ? "font-semibold text-fg-1"
            : "text-fg-3 hover:text-accent"
        }
      >
        EN
      </a>
      <span className="text-fg-3 opacity-60" aria-hidden="true">
        /
      </span>
      <a
        href={buildHref("es")}
        aria-current={current === "es" ? "true" : undefined}
        className={
          current === "es"
            ? "font-semibold text-fg-1"
            : "text-fg-3 hover:text-accent"
        }
      >
        ES
      </a>
    </div>
  );
}
