/**
 * WORKSHOP band — the deep-plum band: tool switcher + contextual in-app nav
 * (active/disabled states) + the EN/ES switcher and account-chip-or-sign-in cluster.
 *
 * @version v0.3.0
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ToolSwitcher } from "./ToolSwitcher";
import { AccountMenu } from "./AccountMenu";
import type { AccountInfo, NavItem, ToolId, ToolLink } from "./types";

export function WorkshopBand({
  tool,
  toolName,
  nav,
  context,
  localeSwitcher,
  account,
  signInHref,
  signInLabel,
  tools,
}: {
  tool: ToolId;
  toolName: string;
  nav?: NavItem[];
  context?: ReactNode;
  localeSwitcher: ReactNode;
  account?: AccountInfo | null;
  signInHref?: string;
  signInLabel?: ReactNode;
  tools: ToolLink[];
}) {
  const { t } = useTranslation("kit");
  const hasNav = (nav && nav.length > 0) || context;

  return (
    <div className="bg-accent-deep">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-7 px-[30px]">
        <ToolSwitcher tool={tool} toolName={toolName} tools={tools} />

        {/* Contextual tool nav — desktop only; mobile uses the sheet. */}
        {hasNav && (
          <nav className="hidden flex-1 items-center gap-[22px] md:flex">
            {context}
            {nav?.map((item, i) =>
              item.disabled ? (
                <span
                  key={i}
                  aria-disabled="true"
                  className="cursor-default font-body text-[13px] uppercase tracking-[0.4px] text-white/30"
                >
                  {item.label}
                </span>
              ) : (
                <a
                  key={i}
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={`relative py-[18px] font-body text-[13px] uppercase tracking-[0.4px] no-underline ${
                    item.active
                      ? "text-white after:absolute after:inset-x-0 after:bottom-[14px] after:h-0.5 after:bg-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {item.label}
                </a>
              ),
            )}
          </nav>
        )}

        {/* Right cluster — desktop only. */}
        <div className="ml-auto hidden items-center gap-[18px] whitespace-nowrap md:flex">
          {localeSwitcher}
          {account ? (
            <AccountMenu account={account} />
          ) : signInHref ? (
            <a
              href={signInHref}
              className="rounded-pill border border-white/20 px-4 py-2 font-title text-[12px] font-medium uppercase tracking-[0.5px] text-white no-underline hover:border-white/40"
            >
              {signInLabel ?? t("header.signIn")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
