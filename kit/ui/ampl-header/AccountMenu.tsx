/**
 * Account menu — the signed-in account chip (avatar or initials + name) on the
 * WORKSHOP band, a <details> menu with the @handle, optional links, and a POST sign-out.
 *
 * @version v0.3.3
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { buildSignOutAction } from "../lib/sign-out";
import { useDismissibleDetails } from "./use-dismissible-details";
import type { AccountInfo } from "./types";

/** Two-letter initials for the avatar fallback (first + last word). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export function AccountMenu({ account }: { account: AccountInfo }) {
  const { t } = useTranslation("kit");
  const signOutAction = buildSignOutAction(account.signOutHref ?? "/auth/logout", account.returnTo);
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref);

  return (
    <details ref={ref} className="relative [&_summary::-webkit-details-marker]:hidden">
      <summary
        aria-haspopup="true"
        className="flex cursor-pointer list-none items-center gap-[9px] whitespace-nowrap rounded-pill border border-white/20 bg-black/[0.18] py-[5px] pl-1.5 pr-3"
      >
        {account.avatarUrl ? (
          <img src={account.avatarUrl} alt="" aria-hidden className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-accent font-display text-[9px] text-white">
            {initials(account.name)}
          </span>
        )}
        <span className="font-body text-[13px] text-accent-pale">{account.name}</span>
        <span className="text-[10px] text-white/60" aria-hidden>▾</span>
      </summary>
      <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[200px] border border-white/20 bg-accent-deep p-1.5">
        <div className="px-2.5 pt-2 pb-2">
          <div className="font-body text-[13px] text-white">{account.name}</div>
          {account.handle && <div className="font-body text-[11px] text-white/60">@{account.handle}</div>}
        </div>
        {account.menu?.map((item, i) => (
          <a
            key={i}
            href={item.href}
            className="block rounded-[6px] px-2.5 py-2 font-body text-[13px] text-white/80 no-underline hover:bg-black/20 hover:text-white"
          >
            {item.label}
          </a>
        ))}
        <form method="post" action={signOutAction}>
          <button
            type="submit"
            className="w-full cursor-pointer rounded-[6px] border-0 bg-transparent px-2.5 py-2 text-left font-body text-[13px] text-white/80 hover:bg-black/20 hover:text-white"
          >
            {t("accountWidget.signOut")}
          </button>
        </form>
      </div>
    </details>
  );
}
