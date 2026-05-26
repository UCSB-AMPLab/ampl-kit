# ampl-kit

Shared foundation for the **AMPL Tools** suite — the family of small tools the
[Archives, Memory, and Preservation Lab (AMPL)](https://ampl.clair.ucsb.edu) at
UC Santa Barbara builds and hosts under [`ampl.tools`](https://ampl.tools).

This repository is two things in one:

- **`@ampl/kit`** — the AMPL design system and shared surfaces (UI primitives,
  theme tokens, fonts, EN/ES locale fragments) plus a session-validation helper,
  consumed by every tool as a tag-pinned git dependency.
- **`ampl-auth`** — the identity Worker, live at
  **[`ampl.tools/auth`](https://ampl.tools/auth)**. One GitHub sign-in gives a
  person one AMPL identity and session that every tool recognises; each tool
  keeps its own authorization.

`ampl-auth` is also `@ampl/kit`'s first consumer — it is built on the very same
public API every other tool depends on.

## How sign-in works

A person signs in once with GitHub at `ampl.tools/auth`. That mints a session
cookie (`__Host-ampl_session`) scoped to the shared `ampl.tools` apex, so every
tool on the domain sees the same identity. Each tool validates that session
locally with a single read-only database query and applies its own authorization
on top — **shared authentication, per-tool authorization.**

## The `@ampl/kit` package

| Import | Contains |
|---|---|
| `@ampl/kit/theme.css` | Tailwind v4 `@theme` tokens + base layer |
| `@ampl/kit/fonts` | `kitFontLinks` for the React Router root `links` export |
| `@ampl/kit/locales/{en,es}` | i18n key fragments (English / Spanish) |
| `@ampl/kit/ui` | Site header/footer, account widget, locale switcher, auth-error and no-access surfaces, and primitives |
| `@ampl/kit/auth` | Session-validation helper + the read-only `AUTH_DB` contract |

`@ampl/kit/ui` is presentational only — no secrets, no database access. The
GitHub OAuth secrets live only in the `ampl-auth` Worker.

### Consuming it

Tools depend on this repo via a tag-pinned git dependency and transpile the
source through Vite:

```jsonc
// package.json
"dependencies": {
  "@ampl/kit": "github:UCSB-AMPLab/ampl-kit#v0.1.0"
}
```

Bumping that tag is how a tool adopts a new `@ampl/kit` release.

```ts
// vite.config.ts
ssr: { noExternal: ["@ampl/kit"] }
```
```css
/* app/app.css */
@import "tailwindcss";
@import "@ampl/kit/theme.css";
@source "../node_modules/@ampl/kit";
```
```ts
// app/root.tsx
import { kitFontLinks } from "@ampl/kit/fonts";
export const links = () => [...kitFontLinks];
```

Then merge `@ampl/kit/locales/{en,es}` into your i18n resources, import surfaces
from `@ampl/kit/ui`, and validate sessions with `@ampl/kit/auth`:

```ts
import { validateSession, safeReturnTo, buildLoginRedirect } from "@ampl/kit/auth";
import { users, sessions, type AuthDbSchema } from "@ampl/kit/auth";

const authDb = drizzle(env.AUTH_DB, { schema: { users, sessions } satisfies AuthDbSchema });
const user = await validateSession(authDb, request); // AuthenticatedUser | null
```

`validateSession` is strictly read-only — one SELECT, no session refresh
(rolling a session is a write, and belongs only to the `ampl-auth` Worker). See
[`kit/README.md`](kit/README.md) for the full `AUTH_DB` schema contract and the
versioning policy.

## Stack

Vite 7 · React Router v7 (SSR on Cloudflare Workers, `v8_middleware`) ·
Cloudflare Workers + D1 (Drizzle ORM) · `arctic` (GitHub OAuth) · Tailwind CSS
v4 · React 19 · i18next + remix-i18next (EN/ES) · CSP-nonce and
security-headers middleware · Vitest (`@cloudflare/vitest-pool-workers`) ·
GitHub Actions CI.

## Local development

```bash
npm install                 # postinstall runs `wrangler types`
npx wrangler login          # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID

# First run: create the D1 database and paste its id into wrangler.jsonc
npx wrangler d1 create ampl-auth-db

npm run db:migrate          # apply migrations to the local miniflare D1
npm run dev                 # http://localhost:5173/auth
```

Sign-in needs a GitHub OAuth app: set `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` with `wrangler secret put` (see `.dev.vars.example` for
local development). The OAuth flow is skipped until they are present.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server + React Router v7 (HMR + miniflare D1) |
| `npm run build` | Production build (nests client assets under `/auth/`) |
| `npm run typecheck` | `wrangler types` + `react-router typegen` + `tsc -b` |
| `npm test -- --run` | Vitest against miniflare D1 |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply migrations to the local miniflare D1 |
| `npm run deploy` | Build + deploy the Worker |

## Smoke test

```bash
bash scripts/smoke.sh http://localhost:5173/auth
```

Pass any deployed base URL to probe a live deployment.

## Layout

```
app/        Worker app — root.tsx, routes/ (landing, ping, auth login/callback/
            logout, locale), middleware/ (security, auth, i18next), db/, lib/,
            locales/, sessions.server.ts
kit/        the @ampl/kit package — ui/ (surfaces + primitives), auth/ (session
            helper + AUTH_DB contract), theme.css, fonts.ts, locales/ (en/es)
workers/    app.ts — Workers entry + baseline security headers
drizzle/    D1 migrations
scripts/    smoke.sh, check-i18n-parity.mjs, rebase-client-assets.mjs
tests/      Vitest suites (routes, middleware, kit, sessions, i18n parity)
```

## License

[AGPL-3.0](LICENSE). These tools follow the lab's minimal-computing-inspired
principles — open source, open and portable formats, bilingual access, and
serverless hosting that scales to zero on Cloudflare's free tier, so running
another tool in the suite costs effectively nothing.
