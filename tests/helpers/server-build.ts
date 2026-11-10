/**
 * Server build for request-level tests
 *
 * `workers/app.ts` loads the React Router server build from the virtual module
 * `virtual:react-router/server-build`, which only the framework's Vite plugin
 * provides. The test pool does not run that plugin, so `vitest.config.ts`
 * aliases the virtual module to this file. It assembles the same shape the
 * build emits: the root and route modules from `app/`, the real server entry,
 * the base path, and the settings from `react-router.config.ts`, including
 * `allowedActionOrigins`. Requests handled through it therefore pass through
 * the framework's own request handling, including its CSRF check.
 *
 * Keep the route table below in step with `app/routes.ts`.
 *
 * @version v0.1.0
 */

import config from "../../react-router.config";
import * as entryServer from "../../app/entry.server";
import * as root from "../../app/root";
import * as index from "../../app/routes/_index";
import * as ping from "../../app/routes/ping";
import * as login from "../../app/routes/auth.login";
import * as github from "../../app/routes/auth.github";
import * as callback from "../../app/routes/auth.callback";
import * as logout from "../../app/routes/auth.logout";
import * as locale from "../../app/routes/locale";
import * as emailRequest from "../../app/routes/auth.email.request";
import * as emailSent from "../../app/routes/auth.email.sent";
import * as emailVerify from "../../app/routes/auth.email.verify";

const basename = config.basename;

function routeEntry(id: string, parentId: string | undefined, module: unknown, path?: string, isIndex?: boolean) {
  return { id, parentId, path, index: isIndex, caseSensitive: undefined, module: module as any };
}

export const routes = {
  root: routeEntry("root", undefined, root, ""),
  "routes/_index": routeEntry("routes/_index", "root", index, undefined, true),
  "routes/ping": routeEntry("routes/ping", "root", ping, "ping"),
  "routes/auth.login": routeEntry("routes/auth.login", "root", login, "login"),
  "routes/auth.github": routeEntry("routes/auth.github", "root", github, "github"),
  "routes/auth.callback": routeEntry("routes/auth.callback", "root", callback, "callback"),
  "routes/auth.logout": routeEntry("routes/auth.logout", "root", logout, "logout"),
  "routes/locale": routeEntry("routes/locale", "root", locale, "locale"),
  "routes/auth.email.request": routeEntry("routes/auth.email.request", "root", emailRequest, "email/request"),
  "routes/auth.email.sent": routeEntry("routes/auth.email.sent", "root", emailSent, "email/sent"),
  "routes/auth.email.verify": routeEntry("routes/auth.email.verify", "root", emailVerify, "email/verify"),
};

/** The browser-facing manifest entry the build emits for a route module. */
function manifestEntry(r: ReturnType<typeof routeEntry>) {
  const m = r.module as Record<string, unknown>;
  return {
    id: r.id,
    parentId: r.parentId,
    path: r.path,
    index: r.index,
    caseSensitive: r.caseSensitive,
    hasAction: typeof m.action === "function",
    hasLoader: typeof m.loader === "function",
    hasClientAction: false,
    hasClientLoader: false,
    hasClientMiddleware: false,
    hasErrorBoundary: typeof m.ErrorBoundary === "function",
    module: `${basename}/assets/${r.id}.js`,
    imports: [] as string[],
    css: [] as string[],
  };
}

export const assets = {
  entry: { module: `${basename}/assets/entry.client.js`, imports: [] as string[] },
  routes: Object.fromEntries(Object.values(routes).map((r) => [r.id, manifestEntry(r)])),
  url: `${basename}/assets/manifest.js`,
  version: "test",
};

export const assetsBuildDirectory = "build/client";
export { basename };
export const entry = { module: entryServer as any };
export const future = {
  unstable_optimizeDeps: false,
  unstable_subResourceIntegrity: false,
  unstable_trailingSlashAwareDataRequests: false,
  v8_splitRouteModules: false,
  ...config.future,
} as any;
export const ssr = config.ssr;
export const isSpaMode = false;
export const prerender: string[] = [];
export const publicPath = `${basename}/`;
export const routeDiscovery = { mode: "lazy", manifestPath: "/__manifest" } as const;
export const allowedActionOrigins = (config as { allowedActionOrigins?: string[] }).allowedActionOrigins;
