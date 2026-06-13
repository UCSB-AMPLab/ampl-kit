/**
 * Institutional band — the white top band: AMPL logo lockup (links to the lab
 * home) + the cross-tool WORKSHOP switcher + lab-site nav, scaling between full
 * and compact; plus the mobile hamburger that toggles the sheet. Owned by the
 * kit (single AMPL identity).
 *
 * v0.3.2: the WORKSHOP tool switcher moved here (first nav item) from the plum
 * band, so its dropdown opens at page-top with nothing below to clip it.
 *
 * @version v0.3.2
 */
import { useTranslation } from "react-i18next";
import amplLogo from "../../assets/ampl-logo.svg";
import { LAB_NAV } from "./lab-nav";
import { ToolSwitcher } from "./ToolSwitcher";
import type { HeaderSize, ToolId, ToolLink } from "./types";

export function InstitutionalBand({
  size,
  labHome,
  menuOpen,
  onMenuToggle,
  tool,
  toolName,
  tools,
}: {
  size: HeaderSize;
  labHome: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  /** v0.3.2: the cross-tool switcher now lives here, as the first nav item. */
  tool: ToolId;
  toolName: string;
  tools: ToolLink[];
}) {
  const { t } = useTranslation("kit");
  const full = size === "full";

  return (
    <div className="border-b border-border bg-bg">
      <div
        className={`mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-[30px] ${
          full ? "pt-8 pb-[30px]" : "py-3.5"
        }`}
      >
        <a
          href={labHome}
          aria-label="AMPL — Archives, Memory, and Preservation Lab"
          className="block self-center leading-none"
        >
          <img src={amplLogo} alt="" className={`block h-auto ${full ? "w-[220px]" : "w-[132px]"}`} />
        </a>

        {/* Switcher + lab nav — desktop only; mobile uses the sheet. The
            WORKSHOP switcher is first (left of the lab links). */}
        <nav
          aria-label={t("nav.ariaLabel")}
          className={`hidden flex-wrap items-center justify-end md:flex ${
            full ? "max-w-[620px] gap-x-8 gap-y-1.5" : "max-w-[540px] gap-x-[26px] gap-y-1"
          }`}
        >
          <ToolSwitcher tool={tool} toolName={toolName} tools={tools} size={size} />
          {LAB_NAV.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={`font-title font-medium uppercase leading-none tracking-[0.5px] text-fg-1 no-underline hover:text-accent ${
                full ? "text-[22px]" : "text-[15px]"
              }`}
            >
              {t(`nav.${item.key}`)}
            </a>
          ))}
        </nav>

        {/* Mobile hamburger — toggles the AmplHeader sheet. */}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="ampl-mobile-sheet"
          aria-label={t("header.menuLabel")}
          onClick={onMenuToggle}
          className="flex h-10 w-10 items-center justify-center rounded-sm border border-accent/20 text-fg-1 md:hidden"
        >
          <span aria-hidden className="text-[18px] leading-none">{menuOpen ? "✕" : "☰"}</span>
        </button>
      </div>
    </div>
  );
}
