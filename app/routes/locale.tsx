import { redirect } from "react-router";
import { localeCookie } from "~/middleware/i18next";
import { safeReturnTo } from "@ampl/kit/auth";
import type { Route } from "./+types/locale";

/**
 * Locale switch
 *
 * This file handles a language change. It is a loader-only route with no UI of
 * its own: when the language switcher links here, it reads the requested
 * language, writes the `lng` cookie that the i18next detection middleware later
 * reads, and bounces the user straight back to the page they were on. The
 * return path is validated through `safeReturnTo`, a hardened open-redirect
 * guard that rejects absolute URLs, protocol-relative `//`, backslashes, and
 * embedded schemes, so a crafted link can never redirect a visitor off-site.
 *
 * `to` is an in-app path WITHOUT the basename — React Router's redirect()
 * re-prepends the basename automatically. The `to` value is routed through
 * `safeReturnTo` (a hardened open-redirect guard) which rejects absolute
 * URLs, protocol-relative `//`, backslashes, and embedded schemes.
 *
 * Cookie written here is read by `app/middleware/i18next.ts` for server-side
 * locale detection.
 *
 * @version v0.1.0
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);

  // Only "es" yields "es"; every other value (missing, unsupported) yields "en".
  const locale = url.searchParams.get("lng") === "es" ? "es" : "en";

  // Guard against open redirects using the hardened utility.
  // `to` arrives already basename-stripped from buildLocaleHref in root.tsx.
  const safeTo = safeReturnTo(url.searchParams.get("to"));

  return redirect(safeTo, {
    headers: { "Set-Cookie": await localeCookie.serialize(locale) },
  });
}
