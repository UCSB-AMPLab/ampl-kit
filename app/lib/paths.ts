/**
 * Base-path helpers
 *
 * This file deals with one persistent nuisance: the whole app lives under the
 * `/auth` base path, but only some links know that automatically. React
 * Router's own `<Link>`, `<Form>`, `useNavigate`, and loader/action redirects
 * already prepend `/auth` for you — so these helpers are strictly for the
 * surfaces that bypass the router. `withBase` adds the base path to raw anchor
 * hrefs and to absolute URLs built by hand (such as the GitHub OAuth
 * `redirect_uri`); `stripBasename` removes it again when capturing a path that
 * will later be fed back through a router redirect, which would otherwise
 * double the prefix. The logic is pure string manipulation, safe to run on
 * both the server and the client.
 *
 * Client- and server-safe (pure string logic). React Router's `basename` makes
 * `<Link>`/`<Form>`/`useNavigate` and loader/action `redirect()` basename-aware
 * automatically — do NOT prefix those. These helpers are only for surfaces that
 * BYPASS the router: server-built absolute URLs (`new URL(...)` — e.g. the
 * GitHub OAuth redirect_uri), raw `<a href>` anchors, and capturing an in-app
 * path for a later re-redirect (`return_to`, which must be basename-relative so
 * the single auto-prepend lands it right).
 *
 * Keep BASENAME in sync with `basename` in react-router.config.ts and `base` in
 * vite.config.ts.
 *
 * @version v0.1.0
 */

/** The app's base path. No trailing slash. */
export const BASENAME = "/auth";

/** Prefixes an in-app absolute path with the basename (raw anchors / URLs). */
export function withBase(path: string): string {
  if (!path.startsWith("/")) return `${BASENAME}/${path}`;
  return `${BASENAME}${path}`;
}

/**
 * Strips a leading basename from a pathname — for capturing an in-app path that
 * will be fed back through a router `redirect()` (which re-prepends the
 * basename). No-op for paths that don't carry the basename.
 */
export function stripBasename(pathname: string): string {
  if (pathname === BASENAME) return "/";
  if (pathname.startsWith(`${BASENAME}/`)) {
    return pathname.slice(BASENAME.length);
  }
  return pathname;
}
