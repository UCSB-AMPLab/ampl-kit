import { useTranslation } from "react-i18next";

/**
 * Account widget
 *
 * This file renders the small "you are signed in as…" card that shows a user's
 * avatar, display name, GitHub handle, and a sign-out link. It is purely
 * presentational — it never reads the session or fetches anything itself;
 * instead the consuming tool passes in the name, handle, avatar URL, and the
 * sign-out link as props, and the widget just draws them. When no avatar URL is
 * given it shows a neutral placeholder circle, and the avatar renders as a
 * plain image subject to the tool's content-security allowlist.
 *
 * Props contract:
 *   name       — display name from users table
 *   handle     — GitHub handle (without @)
 *   avatarUrl  — GitHub avatar URL, or null (placeholder rendered)
 *   signOutHref — consumer passes e.g. withBase("/logout")
 *
 * @version v0.1.0
 */

type AccountWidgetProps = {
  name: string;
  handle: string;
  avatarUrl: string | null;
  signOutHref: string;
};

export function AccountWidget({
  name,
  handle,
  avatarUrl,
  signOutHref,
}: AccountWidgetProps) {
  const { t } = useTranslation("kit");

  return (
    <div className="flex items-center gap-4 rounded-sm border border-border p-4">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden
          className="h-10 w-10 rounded-full border border-border object-cover"
        />
      ) : (
        <div className="h-10 w-10 rounded-full border border-border bg-bg-alt" />
      )}
      <div className="flex flex-col">
        <span className="font-body font-medium text-fg-1">{name}</span>
        <span className="font-body text-small text-fg-2">@{handle}</span>
      </div>
      <a
        href={signOutHref}
        className="ml-auto font-title text-[13px] font-medium uppercase tracking-[0.4px] text-fg-1 no-underline hover:text-accent"
      >
        {t("accountWidget.signOut")}
      </a>
    </div>
  );
}
