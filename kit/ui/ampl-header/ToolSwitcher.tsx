/**
 * Tool switcher — the `WORKSHOP ▾` cluster, a native <details> disclosure. Lives
 * in the white INSTITUTIONAL band as the first nav item (v0.3.2 relocation), so
 * the trigger is styled like the lab-nav links (dark, uppercase title) and scales
 * with the band `size`. The panel itself is the dark plum popover: the current
 * tool in a banner, then the other AMPL tools you can switch to.
 *
 * @version v0.3.3
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDismissibleDetails } from "./use-dismissible-details";
import type { HeaderSize, ToolId, ToolLink } from "./types";

export function ToolSwitcher({
  tool,
  toolName,
  tools,
  size = "compact",
}: {
  tool: ToolId;
  toolName: string;
  tools: ToolLink[];
  /** Institutional-band scale — matches the lab-nav link sizing. */
  size?: HeaderSize;
}) {
  const { t } = useTranslation("kit");
  const current = tools.find((tl) => tl.id === tool);
  const others = tools.filter((tl) => tl.id !== tool);
  const full = size === "full";
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref);

  return (
    <details ref={ref} className="relative [&_summary::-webkit-details-marker]:hidden">
      <summary
        aria-haspopup="true"
        className={`flex cursor-pointer list-none items-center gap-1.5 whitespace-nowrap font-title font-medium uppercase leading-none tracking-[0.5px] text-fg-1 no-underline hover:text-accent ${
          full ? "text-[22px]" : "text-[15px]"
        }`}
      >
        {/* Literal "Workshop" (as the pre-v0.3.2 trigger was) — ES branding of
            this label is a pending decision, deliberately not invented here. */}
        Workshop
        <span className="text-[0.7em] text-fg-3" aria-hidden>▾</span>
      </summary>

      <div className="absolute left-0 top-full z-30 mt-2 w-64 border border-white/20 bg-accent-deepest">
        {/* Current tool — where you are now */}
        <div aria-current="true" className="border-b border-white/20 bg-black/20 px-3.5 py-3">
          <span className="mb-[3px] block font-display text-[8px] uppercase tracking-[1px] text-accent-pale">
            {t("switcher.current")}
          </span>
          <span className="font-title text-[15px] font-medium text-white">{current?.name ?? toolName}</span>
          {current && (
            <span className="mt-px block font-body text-[11px] text-white/60">
              {t(`switcher.tagline.${current.id}`, current.descriptor)}
            </span>
          )}
        </div>

        {/* Switch to — the other tools */}
        {others.length > 0 && (
          <>
            <div className="px-3.5 pt-[9px] pb-[3px] font-display text-[8px] uppercase tracking-[1px] text-white/60">
              {t("switcher.switchTo")}
            </div>
            {others.map((tl) => (
              <a
                key={tl.id}
                href={tl.href}
                className="block px-3.5 pt-[7px] pb-[9px] no-underline hover:bg-black/20"
              >
                <span className="block font-title text-[14px] font-medium leading-tight text-white">{tl.name}</span>
                <span className="block font-body text-[11px] leading-tight text-white/60">
                  {t(`switcher.tagline.${tl.id}`, tl.descriptor)}
                </span>
              </a>
            ))}
          </>
        )}
      </div>
    </details>
  );
}
