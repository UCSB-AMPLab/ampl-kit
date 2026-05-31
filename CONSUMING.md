# Consuming `@ampl/kit`

This guide covers everything a tool on `ampl.tools` needs to wire
`@ampl/kit` correctly — the four integration points that require explicit
care, and the recipe for pinning and updating the git dependency.

---

## Integration requirements

### 1. Apex login/logout targeting

All tools on `ampl.tools` share the same authentication service at
`ampl.tools/auth`. Login and logout must always target the **apex paths**
(`/auth/login`, `/auth/logout`) — never a tool-local path.

**Server-side redirects (loaders)**

Use `buildLoginRedirect` and `buildLogoutHref` (from `@ampl/kit/auth`)
when building an absolute URL inside a server-side `redirect()` call.
These helpers encode `return_to` correctly and produce absolute URLs that
bypass React Router v7's basename re-prepend (which would otherwise
produce a double-prefix like `/palaeography/auth/login`).

```typescript
import { buildLoginRedirect, buildLogoutHref } from "@ampl/kit/auth";

// Redirect an unauthenticated visitor to the login page
const loginUrl = buildLoginRedirect(
  safeReturnTo(returnTo),  // full apex path, e.g. "/palaeography/manuscript/123"
  new URL(request.url).origin,
);
return redirect(loginUrl);

// Build an absolute logout URL for a server action
const logoutUrl = buildLogoutHref(
  safeReturnTo(returnTo),
  new URL(request.url).origin,
);
return redirect(logoutUrl);
```

Both helpers share the same signature:
`(returnTo: string, origin: string, authBasename?: string) → string`

The `authBasename` parameter defaults to `"/auth"` — only override it if
your tool uses a non-standard auth path.

**AccountWidget (client-side form)**

The `AccountWidget` component already uses a `<form method="post">` whose
default action targets `/auth/logout`. No `signOutHref` prop is required
for standard deployments — the widget POSTs to the apex logout endpoint
automatically. Pass `signOutHref` only if you need to override the target
(e.g. in a local dev environment with a different auth origin).

```tsx
import { AccountWidget } from "@ampl/kit/ui";

// Standard: default signOutHref="/auth/logout" — no prop needed
<AccountWidget
  name={user.name}
  avatarUrl={user.avatar_url}
/>

// Override for non-standard auth paths
<AccountWidget
  name={user.name}
  avatarUrl={user.avatar_url}
  signOutHref="https://ampl.tools/auth/logout"
/>
```

---

### 2. CSP avatar host

The `AccountWidget` renders the user's GitHub avatar as a plain `<img>`
tag. Because each tool controls its own Content Security Policy, tools
that render the account widget must explicitly allow the GitHub avatar
host in their `img-src` directive.

Add `avatars.githubusercontent.com` to `img-src`:

```
Content-Security-Policy: img-src 'self' avatars.githubusercontent.com; ...
```

Without this, the avatar image is blocked silently and the widget renders
a broken image placeholder.

---

### 3. Read-only `AUTH_DB` binding

Each tool validates user sessions with a **read-only** binding to the
shared `ampl-auth-db` database. Bind it in your `wrangler.jsonc` as a
D1 database named `AUTH_DB`.

**The session-validation contract is read-only by design.** The
`validateSession` helper issues a single `SELECT` per gated request and
never writes to the database. Binding the database read-only (using
Cloudflare's `prevent_writes` flag) enforces this at the infrastructure
level — the tool can validate sessions but cannot corrupt shared auth
state.

```jsonc
// wrangler.jsonc
{
  "d1_databases": [
    {
      "binding": "AUTH_DB",
      "database_name": "ampl-auth-db",
      "database_id": "<ampl-auth-db-id>",
      "prevent_writes": true   // read-only — session validation never writes
    }
  ]
}
```

Session lifetime: 30-day absolute maximum. The `validateSession` helper
returns `null` for expired or invalid tokens — gate your routes on this
return value.

```typescript
import { redirect } from "react-router";
import {
  validateSession,
  buildLoginRedirect,
  safeReturnTo,
  users,
  sessions,
} from "@ampl/kit/auth";
import { drizzle } from "drizzle-orm/d1";

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = drizzle(context.cloudflare.env.AUTH_DB, {
    schema: { users, sessions },
  });
  const user = await validateSession(db, request);
  if (!user) {
    // Derive the path and origin from the request. Do not pass the full
    // request.url to safeReturnTo — it only accepts root-relative paths and
    // collapses an absolute URL to "/", and buildLoginRedirect needs a real
    // origin to emit an absolute, basename-safe URL.
    const url = new URL(request.url);
    const safeTarget = safeReturnTo(url.pathname + url.search);
    return redirect(buildLoginRedirect(safeTarget, url.origin));
  }
  // user is AuthenticatedUser — { id, name, handle, email, avatarUrl }
}
```

---

### 4. `return_to` basename handling

When redirecting a visitor to the login page, pass the **full apex path**
as `return_to` — do not strip the tool's basename prefix.

```
Correct:   /palaeography/manuscript/123
Incorrect: /manuscript/123   (basename stripped — broken after login)
```

Always guard `return_to` values with `safeReturnTo` before using them:

```typescript
import { safeReturnTo, buildLoginRedirect } from "@ampl/kit/auth";

const returnTo = new URL(request.url).pathname;
const safeTarget = safeReturnTo(returnTo);  // validates; returns "/" on invalid input
const loginUrl = buildLoginRedirect(safeTarget, origin);
```

`safeReturnTo` rejects values that contain `://` (absolute URLs), start
with `//` (protocol-relative), or include backslashes — returning `"/"`
as a safe fallback. Use it on every `return_to` value from a query
parameter or redirect chain before passing it to `buildLoginRedirect` or
`buildLogoutHref`.

The `ampl-auth` service accepts `return_to` as a full apex path and
redirects there directly after login — the absolute-URL redirect avoids
the double-prefix issue (`/auth/auth/...`) that arises when a relative
`redirect()` path collides with React Router's basename prepend.

> **Fixed in v0.2.2 — `return_to` dropped at the login button.** A
> hosted `ampl-auth` service deployed at **v0.2.1 or earlier** dropped
> `return_to` on the login page: the "Continue with GitHub" button did
> not forward the param into the OAuth start link, so the callback always
> landed the user at `/auth` instead of the deep-link destination. This is
> a **service-side fix** — it takes effect when the shared `ampl.tools/auth`
> service is deployed at v0.2.2, and benefits every consumer at once.
> Consumers do not need to change any code; bumping the pinned
> `@ampl/kit` ref to `#v0.2.2` simply keeps the vendored types in step.
> (Calamus, pinned at `#v0.2.1`, is one affected consumer.)

---

## Git dependency — pinning and updating

`@ampl/kit` ships as a tag-pinned git dependency from the public
`UCSB-AMPLab/ampl-kit` repository.

### Initial setup

Add the dependency to your `package.json`:

```json
{
  "dependencies": {
    "@ampl/kit": "github:UCSB-AMPLab/ampl-kit#v0.2.1"
  }
}
```

Then configure Vite and your app CSS:

**`vite.config.ts`** — add `ssr.noExternal: ["@ampl/kit"]` to tell the
SSR bundler to include `@ampl/kit` in the bundle (do not externalize it):

```typescript
export default defineConfig({
  ssr: {
    noExternal: ["@ampl/kit"],
  },
  // ... rest of config
});
```

**`app/app.css`** — import the design tokens and add the kit source to
Tailwind's scanner:

```css
@import "@ampl/kit/theme.css";
@source "../node_modules/@ampl/kit";
```

**`app/root.tsx`** — spread the kit's font `<link>` tags into your route's
`links` export:

```typescript
import { kitFontLinks } from "@ampl/kit/ui";

export const links: Route.LinksFunction = () => [
  ...kitFontLinks(),
  // ... your other links
];
```

### Bumping the pinned version

1. Check for a new release tag at `github.com/UCSB-AMPLab/ampl-kit`.
2. Update the `#vX.Y.Z` ref in `package.json`:

   ```json
   "@ampl/kit": "github:UCSB-AMPLab/ampl-kit#v0.2.1"
   ```

3. Run `npm install` to fetch the new ref and update `package-lock.json`.
4. Run your test suite and typecheck to confirm compatibility.
5. Commit `package.json` and `package-lock.json` together.

There is no separate release branch to track — pin to the exact tag and
bump deliberately.

---

## `@ampl/kit/ui` — `AmplHeader`

`AmplHeader` is the single shared header component for every tool on `ampl.tools`.
It renders two bands: a white institutional band (the AMPL logo lockup and
lab-site nav, owned by the kit) and a deep-plum (#743A6A) WORKSHOP band (tool
switcher, contextual in-app nav, EN/ES, and the signed-in account chip or a
sign-in link). A hamburger-toggled mobile sheet covers narrow screens. All tool
variation comes through props — no per-tool fork of the component.

```typescript
import {
  AmplHeader,
  DEFAULT_TOOLS,
  type AmplHeaderProps,
  type NavItem,
  type ToolLink,
  type ToolId,
  type AccountInfo,
  type HeaderSize,
} from "@ampl/kit/ui";
```

### Compact case (all in-app pages)

```tsx
// Signed-in compact header — standard in-app layout
<AmplHeader
  tool="calamus"
  toolName="Palaeography"
  localeSwitcher={
    <LocaleSwitcher variant="on-dark" buildHref={buildLocaleSwitchHref} current={locale} />
  }
  account={{
    name: user.name,
    handle: user.handle,
    avatarUrl: user.avatar_url,
  }}
  nav={[
    { label: t("nav.manuscripts"), href: "/palaeography/manuscripts", active: true },
    { label: t("nav.groups"),      href: "/palaeography/groups" },
  ]}
/>
```

The `size` prop defaults to `"compact"` and can be omitted on every in-app
page.

### Full case (signed-out front door only)

```tsx
// Signed-out front door — size="full" masthead, no nav
<AmplHeader
  tool="calamus"
  toolName="Palaeography"
  size="full"
  localeSwitcher={
    <LocaleSwitcher variant="on-dark" buildHref={buildLocaleSwitchHref} current={locale} />
  }
  signInHref="/auth/login?return_to=/palaeography"
/>
```

Use `size="full"` **only** on the signed-out front-door page. Every authenticated
page and every intermediate state uses the default `"compact"`. Only the
institutional band scales between the two sizes; the WORKSHOP band is constant
height in both modes.

### `account` vs `signInHref` — signed-in vs signed-out

When `account` is provided the WORKSHOP band renders the signed-in account chip
(avatar or initials + name, with a menu). When `account` is `null` or omitted
the band renders a sign-in link pointing to `signInHref`.

```tsx
// Signed-in
<AmplHeader account={{ name: user.name, avatarUrl: user.avatar_url }} ... />

// Signed-out
<AmplHeader account={null} signInHref="/auth/login?return_to=/palaeography" ... />
```

Override the sign-in link text with `signInLabel` when the default ("Sign in")
does not fit the tool's voice — for example, Scheduling passes
`signInLabel="Host sign in"`.

### `AccountInfo` sign-out

`AccountInfo.signOutHref` defaults to `"/auth/logout"`. Sign-out is a POST form.
Pass `signOutHref` only if you need to override the target (e.g. in a local dev
environment); standard deployments need no override.

### Tool switcher

The WORKSHOP band includes a cross-tool switcher populated from the `tools` prop.
It defaults to `DEFAULT_TOOLS` (Palaeography and Scheduling). Override it to
control which tools appear or to add future tools:

```typescript
import { DEFAULT_TOOLS } from "@ampl/kit/ui";

// Use the default registry — no prop needed
<AmplHeader tools={DEFAULT_TOOLS} ... />

// Override with a custom registry
<AmplHeader
  tools={[
    { id: "calamus",    name: "Palaeography", descriptor: "Practice reading manuscripts", href: "https://ampl.tools/palaeography" },
    { id: "scheduling", name: "Scheduling",   descriptor: "booking & polls",              href: "https://ampl.tools/scheduling" },
  ]}
  ... />
```

The `tool` prop (internal tool id) drives the switcher "current" highlight so
the active tool is visually distinguished.

### LocaleSwitcher variant

Pass `<LocaleSwitcher variant="on-dark" .../>` to `AmplHeader`. The `"on-dark"`
variant is styled for the plum WORKSHOP band; the default light variant is
unsuitable on that background.

### CSP: avatar host

When `account` carries a non-null `avatarUrl`, the header renders the GitHub
avatar as a plain `<img>`. The same CSP requirement applies as for
`AccountWidget` — add `avatars.githubusercontent.com` to `img-src`. See
[section 2, "CSP avatar host"](#2-csp-avatar-host) above.

### Deprecation note

`SiteHeader` is `@deprecated` as of v0.3.0. It is retained for backward
compatibility but new tools should use `AmplHeader`. Existing consumers (Calamus)
should migrate at the next milestone boundary.

---

## `@ampl/kit/email` — bilingual shell + `.ics` builder

The `@ampl/kit/email` subpath ships two pure TypeScript functions —
`renderEmailShell` (the branded HTML + plain-text email shell) and `buildIcs`
(a pure RFC 5545 `.ics` calendar attachment builder) — plus the type contracts
for both the shell/`.ics` inputs and the `send()` RPC. These are the only
surfaces from `@ampl/kit/email`; the underlying modules are not part of the
public contract.

```typescript
import {
  renderEmailShell,
  buildIcs,
  type EmailShellInput,
  type EmailBlock,
  type IcsEvent,
  type SendMessage,   // send() RPC contract — exported as of v0.2.1
  type SendResult,    // send() RPC contract — exported as of v0.2.1
} from "@ampl/kit/email";
```

The `send()` call itself is made via the `EMAIL` service binding on each
tool's Worker environment (`env.EMAIL.send(msg): Promise<SendResult>`) — the
service binding is configured in your `wrangler.jsonc`, not imported from this
subpath, but its `SendMessage` / `SendResult` contract is. (On `v0.2.0` these
two types were not exported; if you are still pinned there, vendor them from
the email Worker's `app/email/types.ts`.)

---

### Recipe 1: Calamus invitation shape

Use this shape for a bilingual invitation email with a CTA button and an
expiry note (no `.ics` attachment).

```typescript
import { renderEmailShell, type EmailShellInput, type SendMessage } from "@ampl/kit/email";

function buildInvitationMessage(locale: "en" | "es"): SendMessage {
  const input: EmailShellInput =
    locale === "en"
      ? {
          locale: "en",
          preheader: "Your palaeography practice invitation from AMPL",
          heading: "You're invited to Calamus",
          blocks: [
            {
              kind: "text",
              content:
                "You have been invited to join a palaeography practice group on Calamus.",
            },
            {
              kind: "button",
              label: "Accept invitation",
              url: "https://ampl.tools/palaeography/invite/<token>",
            },
            { kind: "note", content: "This invitation expires in 14 days." },
          ],
        }
      : {
          locale: "es",
          preheader: "Tu invitación a la práctica de paleografía de AMPL",
          heading: "Estás invitado a Calamus",
          blocks: [
            {
              kind: "text",
              content:
                "Has sido invitado a unirte a un grupo de práctica paleográfica en Calamus.",
            },
            {
              kind: "button",
              label: "Aceptar invitación",
              url: "https://ampl.tools/palaeography/invite/<token>",
            },
            { kind: "note", content: "Esta invitación expira en 14 días." },
          ],
        };

  const { html, text } = renderEmailShell(input);

  return {
    to: "user@example.com",
    subject: "[Calamus] Invitation to practice group",
    html,
    text,
    tool: "calamus",
    locale,
    idempotencyKey: `calamus-invite-<bookingId>-${locale}`,
  };
}

// In your Worker or action:
const msg = buildInvitationMessage("en");
const result = await env.EMAIL.send(msg);
```

---

### Recipe 2: Scheduling event-email shape (with `.ics` attachment)

Use this shape for appointment confirmation, cancellation, poll-finalisation,
and reminder emails that include a calendar attachment.

```typescript
import { renderEmailShell, buildIcs, type EmailShellInput, type IcsEvent, type SendMessage } from "@ampl/kit/email";

function buildSchedulingMessage(
  subject: string,
  method: "REQUEST" | "CANCEL",
  event: IcsEvent,
): SendMessage {
  // method = "REQUEST" for confirmation / poll-finalisation / reminder
  // method = "CANCEL" for cancellation (event.sequence MUST be > original)

  const shellInput: EmailShellInput = {
    locale: "en",
    heading: method === "REQUEST" ? "Appointment confirmed" : "Appointment cancelled",
    blocks: [
      {
        kind: "text",
        content:
          method === "REQUEST"
            ? "Your appointment has been confirmed."
            : "Your appointment has been cancelled.",
      },
      {
        kind: "details",
        rows: [
          { label: "Date", value: "June 15, 2026" },
          { label: "Time", value: "10:00 AM" },
        ],
      },
    ],
  };

  const { html, text } = renderEmailShell(shellInput);
  const icsContent = buildIcs(event);

  return {
    to: "user@example.com",
    subject: `[Scheduling] ${subject}`,
    html,
    text,
    tool: "scheduling",
    attachments: [
      {
        content: icsContent,            // raw .ics string — the Worker base64-encodes it
        filename: "event.ics",
        // RULE 1: the method= parameter MUST match IcsEvent.method — see note below
        type: `text/calendar; charset=utf-8; method=${event.method}`,
      },
    ],
  };
}

// Build the event — caller supplies the uid from the booking record:
const event: IcsEvent = {
  uid: "booking-123@ampl.tools",   // stable per booking — SAME across REQUEST and CANCEL
  sequence: 0,                      // 0 on first REQUEST; MUST be incremented for CANCEL
  method: "REQUEST",
  summary: "Lab consultation",
  dtstart: new Date("2026-06-15T10:00:00Z"),
  dtend: new Date("2026-06-15T11:00:00Z"),
  organizer: { email: "noreply@ampl.tools", name: "AMPL" },
  attendees: [{ email: "user@example.com", name: "User" }],
};

const msg = buildSchedulingMessage("Appointment confirmed", "REQUEST", event);
const result = await env.EMAIL.send(msg);
```

---

### Non-obvious contract rules

Three correctness requirements that are not enforced by types — document
them here because a mistake is silent (the email delivers, but the calendar
behaves incorrectly):

**Rule 1 — The content-type `method=` parameter must match `IcsEvent.method`.**
The MIME content-type `text/calendar; charset=utf-8; method=REQUEST` (or
`method=CANCEL`) must exactly match the `METHOD:` property inside the `.ics`
file. RFC 6047 (iMIP) requires this consistency. Mismatching the two causes
Outlook to treat the calendar attachment as a generic file rather than a
calendar update — it will not prompt the user to add or remove the event.
Derive the parameter directly from the event: `` `method=${event.method}` ``.

**Rule 2 — For CANCEL: increment SEQUENCE and reuse the same UID.**
When cancelling an appointment, the CANCEL `.ics` must carry the **same
`uid`** as the original REQUEST **and** a `sequence` value that is **strictly
greater** than the REQUEST's sequence. Calendar clients use SEQUENCE to
determine which send supersedes which. If the CANCEL has the same SEQUENCE
as the original REQUEST, the client sees them as identical revisions and may
leave the event on the recipient's calendar unchanged.

Practical implication for Scheduling: store the event's `sequence` in your D1
database at confirmation time (it starts at 0). When the appointment is
cancelled, read that stored value and pass `sequence + 1` to `buildIcs`. The
stable `uid` (e.g. `booking-<id>@ampl.tools`) ties the two sends together.

```typescript
// On confirmation:
const event: IcsEvent = { uid: "booking-123@ampl.tools", sequence: 0, method: "REQUEST", ... };
// Store sequence: 0 in your DB alongside the booking record.

// On cancellation (read sequence from DB, increment it):
const cancelEvent: IcsEvent = {
  uid: "booking-123@ampl.tools",  // SAME uid as the REQUEST
  sequence: storedSequence + 1,   // MUST be > the original sequence
  method: "CANCEL",
  ...                             // same summary, dtstart, dtend, organizer, attendees
};
```

**Rule 3 — The AMPL logo: hosted HTTPS only.**
The shell renders the AMPL logo via `<img src="...">`. By default it uses
the kit-level constant `DEFAULT_AMPL_LOGO_URL` exported from
`@ampl/kit/email/shell`. You may override it per-send via the optional
`EmailShellInput.logoUrl` field.

The logo URL must be a real hosted HTTPS URL — data URIs, inline SVG, and
CID (Content-ID) attachments are stripped by Gmail and Outlook and will not
render for most recipients.

**Deployment follow-up:** the default `DEFAULT_AMPL_LOGO_URL` points to
`https://ampl.clair.ucsb.edu/assets/ampl-logo.png`. The actual PNG asset
must be uploaded and served at that URL before the logo appears in live
emails. This upload is a deployment step outside the kit itself; it is not
gating the kit surface. Until the asset is live, pass your own `logoUrl`
in `EmailShellInput` to use a URL you control.

```typescript
// Override the logo per-send:
const input: EmailShellInput = {
  locale: "en",
  heading: "...",
  blocks: [...],
  logoUrl: "https://your-host.example.com/ampl-logo.png",
};
```

---

### Versioning and breaking changes

The git tag is the contract for `@ampl/kit`. Consumers pin to an exact tag:

```json
"@ampl/kit": "github:UCSB-AMPLab/ampl-kit#v0.2.1"
```

**This release:** `v0.3.1` refines the `AmplHeader` WORKSHOP switcher dropdown —
it now surfaces the current tool in a banner above a "switch to" list, on a
deeper-plum panel that separates from the band without a shadow. No API change
(the `AmplHeader` props are unchanged); internally it adds the `accent-deepest`
token and swaps the kit `switcher.heading` string for `switcher.current` /
`switcher.switchTo`. A patch bump — consumers pinning `v0.3.0` upgrade by
bumping the ref; nothing else changes.

`v0.3.0` adds `AmplHeader` — a new UI component exported from
`@ampl/kit/ui`, along with the `DEFAULT_TOOLS` registry and the types
`AmplHeaderProps`, `NavItem`, `ToolLink`, `ToolId`, `AccountInfo`, and
`HeaderSize`. It also adds the `kit.nav`, `kit.switcher`, and `kit.header` i18n
string groups and the `"on-dark"` `LocaleSwitcher` variant. This is purely
additive — a **minor** bump. `SiteHeader` is deprecated but retained for
back-compat; no consumer is required to migrate. (`v0.2.2` fixed a `return_to`
bug in the hosted `ampl-auth` service: the login page dropped `return_to` at
the "Continue with GitHub" button, so deep-link-after-login always landed at
`/auth` — a service-side fix with no library API change. `v0.2.1` exported the
`send()` RPC contract — `SendMessage`, `SendResult` — from `./email`; `v0.2.0`
added the `./email` subpath itself: `renderEmailShell`, `buildIcs`,
`EmailShellInput`, `EmailBlock`, `IcsEvent`.) Consumers on `v0.1.0` are
unaffected at the library level — the `./auth` subpath is unchanged.

**Policy:**

| Change type | Version impact | Examples |
|-------------|---------------|---------|
| New optional field on an existing type | **minor bump** | Adding `logoUrl` to `EmailShellInput` |
| New `EmailBlock` kind | **minor bump** | A future `{kind:"image"}` block |
| Rename or remove a field | **major bump** | Removing `IcsEvent.sequence`, renaming `method` |
| Make an optional field required | **major bump** | Making `logoUrl` required |
| Remove an exported function or type | **major bump** | Removing `buildIcs` |

To upgrade, follow the recipe in "Bumping the pinned version" above: update
the `#vX.Y.Z` ref, run `npm install`, run the test suite, and commit.
