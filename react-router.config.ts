/**
 * React Router framework configuration
 *
 * This file configures how React Router builds and serves the app. It enables
 * server-side rendering, mounts the entire app under the `/auth` base path so it
 * lives at `ampl.tools/auth`, and opts into the v8 middleware and
 * Vite-environment future flags. The `/auth` basename must stay in sync with the
 * Vite `base` in `vite.config.ts` and `BASENAME` in `app/lib/paths.ts`.
 *
 * @version v0.1.0
 */
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Served under ampl.tools/auth. Keep in sync with Vite `base` in
  // vite.config.ts and BASENAME in app/lib/paths.ts.
  basename: "/auth",
  future: {
    v8_viteEnvironmentApi: true,
    v8_middleware: true,
  },
} satisfies Config;
