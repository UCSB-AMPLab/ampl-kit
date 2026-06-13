/**
 * Mobile sheet — the full-width hamburger-toggled panel for narrow screens:
 * workshop switcher + lab nav + tool nav + EN/ES + account/sign-in. Always in
 * the DOM; visibility via the `hidden`/`aria-hidden` toggle so it is SSR-present
 * and tab-order-correct.
 *
 * v0.3.2: gains a "switch tool" section (current + other tools), since the
 * desktop switcher now lives in the institutional band which collapses here.
 *
 * @version v0.3.2
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { buildSignOutAction } from "../lib/sign-out";
import { LAB_NAV } from "./lab-nav";
import type { AccountInfo, NavItem, ToolId, ToolLink } from "./types";

export function MobileSheet({
  open,
  nav,
  context,
  localeSwitcher,
  account,
  signInHref,
  signInLabel,
  tool,
  toolName,
  tools,
}: {
  open: boolean;
  nav?: NavItem[];
  context?: ReactNode;
  localeSwitcher: ReactNode;
  account?: AccountInfo | null;
  signInHref?: string;
  signInLabel?: ReactNode;
  tool: ToolId;
  toolName: string;
  tools: ToolLink[];
}) {
  const { t } = useTranslation("kit");
  const signOutAction = account
    ? buildSignOutAction(account.signOutHref ?? "/auth/logout", account.returnTo)
    : "";
  const currentTool = tools.find((tl) => tl.id === tool);
  const otherTools = tools.filter((tl) => tl.id !== tool);

  return (
    <div
      id="ampl-mobile-sheet"
      hidden={!open}
      aria-hidden={!open}
      className="border-t border-white/20 bg-accent-deep px-[30px] py-5 md:hidden"
    >
      {/* Workshop switcher — current tool + switch-to links */}
      <div className="flex flex-col gap-1.5 pb-5">
        <span className="font-display text-[8px] uppercase tracking-[1px] text-accent-pale">
          {t("switcher.current")}
        </span>
        <span className="font-title text-[18px] font-medium text-white">
          {currentTool?.name ?? toolName}
        </span>
        {otherTools.length > 0 && (
          <>
            <span className="mt-2 font-display text-[8px] uppercase tracking-[1px] text-white/60">
              {t("switcher.switchTo")}
            </span>
            {otherTools.map((tl) => (
              <a key={tl.id} href={tl.href} className="font-title text-[16px] font-medium text-white no-underline">
                {tl.name}
              </a>
            ))}
          </>
        )}
      </div>

      {/* Lab nav */}
      <nav aria-label={t("nav.ariaLabel")} className="flex flex-col gap-3 border-t border-white/20 pt-5">
        {LAB_NAV.map((item) => (
          <a key={item.key} href={item.href} className="font-title text-[18px] uppercase tracking-[0.5px] text-white no-underline">
            {t(`nav.${item.key}`)}
          </a>
        ))}
      </nav>

      {/* Tool nav */}
      {((nav && nav.length > 0) || context) && (
        <nav className="mt-5 flex flex-col gap-3 border-t border-white/20 pt-5">
          {context}
          {nav?.map((item, i) =>
            item.disabled ? (
              <span key={i} aria-disabled="true" className="font-body text-[14px] uppercase tracking-[0.4px] text-white/30">
                {item.label}
              </span>
            ) : (
              <a key={i} href={item.href} aria-current={item.active ? "page" : undefined}
                className={`font-body text-[14px] uppercase tracking-[0.4px] no-underline ${item.active ? "text-white" : "text-white/70"}`}>
                {item.label}
              </a>
            ),
          )}
        </nav>
      )}

      {/* Locale + account/sign-in */}
      <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/20 pt-5">
        {localeSwitcher}
        {account ? (
          <form method="post" action={signOutAction}>
            <button type="submit" className="cursor-pointer rounded-pill border border-white/20 bg-black/[0.18] px-4 py-2 font-body text-[13px] text-white">
              {t("accountWidget.signOut")}
            </button>
          </form>
        ) : signInHref ? (
          <a href={signInHref} className="rounded-pill border border-white/20 px-4 py-2 font-title text-[12px] font-medium uppercase tracking-[0.5px] text-white no-underline">
            {signInLabel ?? t("header.signIn")}
          </a>
        ) : null}
      </div>
    </div>
  );
}
