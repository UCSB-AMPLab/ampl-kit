/**
 * Client asset rebase step
 *
 * This script runs right after `react-router build` and moves the built client
 * files so their URLs line up with how Cloudflare serves them. The build is
 * configured with a `/auth/` base, so the generated HTML points at
 * `/auth/assets/*` — but the Cloudflare Assets binding serves the
 * `build/client` directory at the zone root, where the folder tree *is* the URL
 * tree, and production only routes `ampl.tools/auth*` to this Worker. Left as
 * built, the asset URLs would not resolve. So this step nests everything in
 * `build/client/` (apart from the `.assetsignore` marker) into
 * `build/client/auth/`, making the served paths match the references. It is
 * idempotent — re-running it once the files are already nested does nothing.
 * The `auth` segment must stay in step with the Vite base, the router basename,
 * and `BASENAME` in `app/lib/paths.ts`.
 *
 * @version v0.1.0
 */
import { readdirSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE_SEGMENT = "auth";
const clientDir = "build/client";
const targetDir = join(clientDir, BASE_SEGMENT);

if (!existsSync(clientDir)) {
  console.error(
    `[rebase-assets] ${clientDir} not found — run after \`react-router build\``,
  );
  process.exit(1);
}

const entries = readdirSync(clientDir).filter(
  (name) => name !== BASE_SEGMENT && name !== ".assetsignore",
);

if (entries.length === 0) {
  console.log(`[rebase-assets] already nested under /${BASE_SEGMENT}/ — nothing to do`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
for (const name of entries) {
  renameSync(join(clientDir, name), join(targetDir, name));
}
console.log(
  `[rebase-assets] nested ${entries.length} entr${entries.length === 1 ? "y" : "ies"} under ${clientDir}/${BASE_SEGMENT}/`,
);
