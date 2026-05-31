/**
 * Tool switcher — the `Workshop · {tool} ▾` cluster on the WORKSHOP band, a
 * native <details> disclosure. The panel surfaces the current tool in a banner,
 * then lists the other AMPL tools you can switch to (current-banner + others).
 *
 * @version v0.3.1
 */
import { useTranslation } from "react-i18next";
import type { ToolId, ToolLink } from "./types";

export function ToolSwitcher({
  tool,
  toolName,
  tools,
}: {
  tool: ToolId;
  toolName: string;
  tools: ToolLink[];
}) {
  const { t } = useTranslation("kit");
  const current = tools.find((tl) => tl.id === tool);
  const others = tools.filter((tl) => tl.id !== tool);

  return (
    <details className="relative [&_summary::-webkit-details-marker]:hidden">
      <summary
        aria-haspopup="true"
        className="flex cursor-pointer list-none items-center gap-[11px] whitespace-nowrap"
      >
        <span className="font-display text-[12px] uppercase tracking-[1.5px] text-accent-pale">Workshop</span>
        <span className="text-white/20" aria-hidden>·</span>
        <span className="font-title text-[20px] font-medium tracking-[-0.2px] text-white">{toolName}</span>
        <span className="ml-0.5 text-[11px] text-white/60" aria-hidden>▾</span>
      </summary>

      <div className="absolute left-0 top-full z-20 w-64 border border-white/20 bg-accent-deepest">
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
