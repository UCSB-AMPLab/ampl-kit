import { useTranslation } from "react-i18next";

/**
 * Account widget
 *
 * This file renders the small "you are signed in as…" card that shows a user's
 * avatar, display name, GitHub handle, and a sign-out control. It is purely
 * presentational — it never reads the session or fetches anything itself;
 * instead the consuming tool passes in the name, handle, avatar URL, and the
 * POST logout endpoint as props, and the widget just draws them. When no avatar
 * URL is given it shows a neutral placeholder circle, and the avatar renders as
 * a plain image subject to the tool's content-security allowlist.
 *
 * Sign-out is a POST `<form>` driven by a submit button — never a GET `<a>`.
 * Every logout endpoint is action-only by design (a GET returns 405), so a
 * plain anchor could never log anyone out; the form is what actually drives
 * the POST. The button is styled to read exactly like the old link.
 *
 * Props contract:
 *   name        — display name from users table
 *   handle      — GitHub handle (without @)
 *   avatarUrl   — GitHub avatar URL, or null (placeholder rendered)
 *   signOutHref — the POST logout endpoint, e.g. withBase("/logout")
 *   returnTo    — optional post-logout destination; appended to the action as a
 *                 ?return_to= query param (the logout route reads it from the
 *                 query string and guards it with safeReturnTo). A POST form
 *                 preserves its action URL's query string, so this reaches the
 *                 route; a hidden input would land in the body and be ignored.
 *
 * @version v0.1.1
 */

type AccountWidgetProps = {
  name: string;
  handle: string;
  avatarUrl: string | null;
  signOutHref: string;
  returnTo?: string;
};

// Append a guarded return_to to the logout endpoint without clobbering any
// query string signOutHref may already carry. Built with URLSearchParams rather
// than string concatenation so existing params survive and the value is encoded
// (split on "?" keeps this working for relative hrefs, which `new URL()` can't
// parse without a base).
function buildSignOutAction(signOutHref: string, returnTo?: string): string {
  if (!returnTo) return signOutHref;
  const [path, existingQuery = ""] = signOutHref.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("return_to", returnTo);
  return `${path}?${params.toString()}`;
}

export function AccountWidget({
  name,
  handle,
  avatarUrl,
  signOutHref,
  returnTo,
}: AccountWidgetProps) {
  const { t } = useTranslation("kit");
  const signOutAction = buildSignOutAction(signOutHref, returnTo);

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
      <form method="post" action={signOutAction} className="ml-auto">
        <button
          type="submit"
          className="cursor-pointer border-0 bg-transparent p-0 font-title text-[13px] font-medium uppercase tracking-[0.4px] text-fg-1 no-underline hover:text-accent"
        >
          {t("accountWidget.signOut")}
        </button>
      </form>
    </div>
  );
}
