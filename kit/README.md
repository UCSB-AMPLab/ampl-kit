# @ampl/kit (the shared layer of this repo)

This `kit/` directory is the publishable **`@ampl/kit`** package — the AMPL design
language and shared surfaces every `ampl.tools` tool consumes. It lives in the same
repo as the deployed **`ampl-auth`** Worker (`app/`, `workers/`); the auth app is
`@ampl/kit`'s first consumer, and other tools depend on this repo via a tag-pinned
git dependency.

## Subpaths

| Import | Contains | Status |
|---|---|---|
| `@ampl/kit/theme.css` | Tailwind v4 `@theme` tokens + base layer | ✅ |
| `@ampl/kit/fonts` | `kitFontLinks` for the RR root `links` export | ✅ |
| `@ampl/kit/locales/{en,es}` | i18n key fragments | ✅ (es pending review) |
| `@ampl/kit/ui` | footer, header, account widget, no-access, auth-error, report-a-problem, primitives | ⏳ scaffold |
| `@ampl/kit/auth` | session-validation helper + read-only `AUTH_DB` contract | ✅ |

`@ampl/kit/ui` is presentational only — no secrets, no DB access. The single secret
(`GITHUB_CLIENT_SECRET`) lives only in the `ampl-auth` Worker env.

## AUTH_DB contract (`@ampl/kit/auth`)

The `./auth` subpath exports the canonical read-only `AUTH_DB` interface that every
consumer tool uses to validate sessions locally with a single D1 SELECT per request.

### Schema columns (stable; breaking change = major version bump)

**`users`**

| Column | Type | Notes |
|---|---|---|
| `id` | `integer` PK | Canonical AMPL user id — FK target for tool authz tables |
| `github_id` | `integer` UNIQUE NOT NULL | GitHub account id (stable across renames) |
| `email` | `text` NOT NULL | GitHub-verified primary email (invitation matching) |
| `handle` | `text` NOT NULL | GitHub login handle |
| `name` | `text` | GitHub display name (nullable) |
| `avatar_url` | `text` | GitHub avatar URL (nullable) |
| `created_at` | `integer` NOT NULL | Unix ms |
| `last_seen_at` | `integer` | Unix ms (nullable) |

**`sessions`**

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | `sha256(rawCookieValue)` hex — the token hash, not the raw token |
| `user_id` | `integer` NOT NULL | FK → `users.id` |
| `created_at` | `integer` NOT NULL | Unix ms |
| `expires_at` | `integer` NOT NULL | Unix ms — row is inert when `<= Date.now()` |
| `last_seen_at` | `integer` | Unix ms (nullable) — updated by rolling refresh |

### API

```ts
import { validateSession, safeReturnTo, buildLoginRedirect } from "@ampl/kit/auth";
import { users, sessions, type AuthDbSchema } from "@ampl/kit/auth";

// Bind to read-only subset:
const authDb = drizzle(env.AUTH_DB, { schema: { users, sessions } satisfies AuthDbSchema });

// Validate a session cookie → AuthenticatedUser | null
const user = await validateSession(authDb, request);

// Open-redirect guard for return_to values
const returnTo = safeReturnTo(url.searchParams.get("return_to"));

// Build absolute login URL (bypasses React Router basename prepend)
const loginUrl = buildLoginRedirect(returnTo, url.origin);
// → "https://ampl.tools/auth/login?return_to=%2Fpalaeography"
```

### Non-refresh note

`validateSession` is strictly **read-only** — it issues a single SELECT and returns
`AuthenticatedUser | null`. It does **not** roll (refresh) the session.

Rolling is a write operation (`UPDATE sessions SET expires_at = ...`) that belongs
only in the ampl-auth Worker's `authMiddleware`, which holds a write-capable db
connection. Consumer tools bind `AUTH_DB` at the application level with only
`{ users, sessions }` in scope — no write helpers are available.

**Consequence:** Tool-resident users who never hit an `/auth/*` route will
re-authenticate at the 30-day absolute session limit. The re-auth is a near-instant
GitHub OAuth bounce (already authorized) — no credential entry. A touch/refresh
endpoint may be added in a future version if the 30-day limit proves disruptive in
practice. For v0.1, accept the tradeoff.

## Consuming it (other tools)

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
export const links: Route.LinksFunction = () => [...kitFontLinks];
```

Then merge `@ampl/kit/locales/{en,es}` and import surfaces from `@ampl/kit/ui`.
