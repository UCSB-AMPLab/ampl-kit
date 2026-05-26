/**
 * Route table
 *
 * This file is the map that tells React Router which module answers which URL.
 * Because the whole app is served under the `/auth` base path, the entries
 * here are written relative to it — `login`, `github`, `callback`, `logout`,
 * and `locale` — plus a `ping` health probe and the bare index landing. Each
 * line pairs a path with the route module that handles it; React Router reads
 * this table at build time to generate types and at runtime to dispatch
 * requests.
 *
 * @version v0.1.0
 */

import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("ping", "routes/ping.tsx"),
  route("login", "routes/auth.login.tsx"),
  route("github", "routes/auth.github.tsx"),
  // Callback + logout registered here alongside their route-module files.
  // RR v7 typegen throws ENOENT if a routes.ts entry references a module that does not
  // yet exist — both auth.callback.tsx and auth.logout.tsx exist.
  route("callback", "routes/auth.callback.tsx"),
  route("logout", "routes/auth.logout.tsx"),
  route("locale", "routes/locale.tsx"),
] satisfies RouteConfig;
