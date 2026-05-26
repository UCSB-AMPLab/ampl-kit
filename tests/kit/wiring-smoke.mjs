/**
 * Tailwind kit-scanning smoke check
 *
 * This script confirms that Tailwind actually scans the shared `kit/` source
 * when it generates CSS — the highest-risk part of the build wiring. The
 * `bg-accent-ink` utility is defined in `kit/theme.css` and used nowhere in
 * `app/`, so it can only appear in the built CSS bundle if Tailwind's
 * `@source "../kit"` directive in `app/app.css` truly reached into the kit
 * directory. The script reads the built client CSS off disk and looks for that
 * sentinel utility (by class name or its literal colour value); finding it
 * means the wiring is sound, and not finding it means Tailwind is missing the
 * kit source. It runs as a standalone Node script — not inside the Workers test
 * pool — because it needs `node:fs` to read the build output, which the Workers
 * runtime does not provide.
 *
 * Usage:
 *   npm run build && node tests/kit/wiring-smoke.mjs
 *
 * If this check fails with "sentinel class NOT found":
 *   1. Try @source "kit" (project-root-relative form) in app/app.css
 *   2. Rebuild: npm run build
 *   3. Re-run this check
 *   See the fallback guidance below.
 *
 * @version v0.1.0
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CLIENT_DIR = "build/client/auth/assets";

if (!existsSync(CLIENT_DIR)) {
  console.error(
    `[wiring-smoke] ERROR: ${CLIENT_DIR} not found.`,
    "\n  Run 'npm run build' before running this check.",
  );
  process.exit(1);
}

// Collect all .css files from the built client assets directory
const cssFiles = readdirSync(CLIENT_DIR).filter((f) => f.endsWith(".css"));

if (cssFiles.length === 0) {
  console.error(
    `[wiring-smoke] ERROR: No CSS files found in ${CLIENT_DIR}.`,
    "\n  Run 'npm run build' to generate the client assets.",
  );
  process.exit(1);
}

// Concatenate all CSS bundle content
const allCss = cssFiles
  .map((f) => readFileSync(join(CLIENT_DIR, f), "utf-8"))
  .join("\n");

// Check for the sentinel class output — Tailwind v4 generates the utility as:
//   .bg-accent-ink { background-color: var(--color-accent-ink) }
// or if inlined: background-color: #8b467d (the literal token value)
// We check for the token name (case-insensitive) to cover both forms.
const SENTINEL_PATTERNS = [
  /accent-ink/i,
  /#8b467d/i,
];

const found = SENTINEL_PATTERNS.some((pattern) => pattern.test(allCss));

if (found) {
  console.log(
    `[wiring-smoke] PASS: sentinel class bg-accent-ink found in built CSS.`,
    `\n  @source "../kit" in app/app.css successfully scans kit/ source.`,
    `\n  Resolved: the @source path is correct.`,
  );
  console.log(
    `  CSS files checked (${CLIENT_DIR}):`,
    cssFiles.join(", "),
  );
  process.exit(0);
} else {
  console.error(
    `[wiring-smoke] FAIL: sentinel class bg-accent-ink NOT found in built CSS.`,
    `\n  Tailwind is NOT scanning kit/ source files.`,
    `\n`,
    `\n  DIAGNOSIS: the @source path in app/app.css may be incorrect.`,
    `\n  Current path: @source "../kit"`,
    `\n`,
    `\n  FALLBACK: try @source "kit" (project-root-relative form) in app/app.css`,
    `\n  and rebuild: npm run build`,
    `\n  See the fallback guidance in this file's header.`,
  );
  console.error(`  CSS files checked (${CLIENT_DIR}):`, cssFiles.join(", "));
  process.exit(1);
}
