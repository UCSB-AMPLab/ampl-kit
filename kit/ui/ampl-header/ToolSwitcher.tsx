/**
 * Tool switcher — the `Workshop · {tool} ▾` cluster on the WORKSHOP band, a
 * native <details> disclosure listing the AMPL tool registry; marks the current tool.
 *
 * @version v0.3.0
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
      <div className="absolute left-0 top-full z-20 -mt-px min-w-[230px] border border-t-0 border-white/20 bg-accent-deep p-1.5">
        <div className="px-2.5 pt-2 pb-1 font-display text-[10px] uppercase tracking-[1px] text-white/60">
          {t("switcher.heading")}
        </div>
        {tools.map((tl) => {
          const current = tl.id === tool;
          return (
            <a
              key={tl.id}
              href={tl.href}
              aria-current={current ? "true" : undefined}
              className="flex items-baseline gap-2 rounded-[6px] px-2.5 py-2.5 no-underline hover:bg-black/20"
            >
              <span className={`font-title text-[15px] font-medium ${current ? "text-accent-pale" : "text-white"}`}>
                {tl.name}
              </span>
              <span className="font-body text-[11px] text-white/60">
                — {t(`switcher.tagline.${tl.id}`, tl.descriptor)}
              </span>
            </a>
          );
        })}
      </div>
    </details>
  );
}
