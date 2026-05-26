/**
 * Vite configuration
 *
 * This file configures Vite — the dev server and production bundler. It serves
 * the app under the `/auth` base path, points `@ampl/kit` imports at the local
 * `kit/` directory (needed because the Tailwind plugin resolves CSS `@import`s
 * by alias only), and wires up the Cloudflare, Tailwind, React Router, and
 * tsconfig-paths plugins. It also marks `@ampl/kit` as inlined for server-side
 * rendering, so its source is bundled rather than treated as an external
 * dependency.
 *
 * @version v0.1.0
 */
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "node:path";

export default defineConfig({
  // Served under ampl.tools/auth. Trailing slash required. Keep in sync with
  // `basename` in react-router.config.ts and BASENAME in app/lib/paths.ts.
  base: "/auth/",
  resolve: {
    alias: {
      // Maps @ampl/kit imports to the local kit/ directory.
      // REQUIRED (not tsconfig paths alone): @tailwindcss/vite uses aliasOnly:true,
      // which skips tsconfig path resolution for CSS @imports.
      // See: github.com/tailwindlabs/tailwindcss/issues/19802
      "@ampl/kit": resolve(__dirname, "./kit"),
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  ssr: {
    // Kept for explicitness and for when external consumers use node_modules.
    // Technically redundant when resolve.alias maps to a local filesystem path
    // (aliased local code is auto-inlined in SSR mode), but kept for parity.
    noExternal: ["@ampl/kit"],
  },
});
