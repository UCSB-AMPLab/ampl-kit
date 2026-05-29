/**
 * kit/email public contract types
 *
 * This file defines the client-surface types that form the `@ampl/kit/email`
 * contract: `EmailShellInput`, `EmailBlock`, and `IcsEvent`. Every tool that
 * renders an email shell or builds a calendar attachment imports from here.
 * `SendMessage` (the Worker-side RPC shape) stays in `app/email/types.ts`; this
 * file holds only the shapes that kit consumers need — the block DSL and the
 * iCalendar event model.
 *
 * Named exports only. No default export. No runtime values — type declarations
 * are compile-time only.
 *
 * @version v0.2.0
 */

// ─────────────────────────────────────────────────────────────────────────────
// EmailBlock — closed discriminated union
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single content block within an email shell.
 *
 * The union is deliberately closed — there is no `{kind:"html"}` escape hatch.
 * Raw-HTML blocks are not supported; all consumer-supplied string values are
 * HTML-escaped by `renderEmailShell` before interpolation, so this surface is
 * safe for user-controlled data. Consumers compose their message from exactly
 * these four block types.
 *
 * Members:
 *   - `text`    — a paragraph of plain prose. The `content` string is
 *                 HTML-escaped; no inline markup is rendered.
 *   - `button`  — a CTA button (label + URL). The `url` must use an `https:`
 *                 or `mailto:` scheme; other schemes are neutralized. Rendered
 *                 as a bulletproof table-cell button in HTML; as a plain
 *                 "label: url" line in text.
 *   - `details` — a key/value grid (e.g. date, time, location). Rendered as a
 *                 table in HTML; as "Label: value" lines in text.
 *   - `note`    — a muted helper text block (e.g. "This link expires in 14 days").
 *                 Visually distinguished from `text` blocks.
 */
export type EmailBlock =
  | { kind: "text"; content: string }
  | { kind: "button"; label: string; url: string }
  | { kind: "details"; rows: { label: string; value: string }[] }
  | { kind: "note"; content: string };

// ─────────────────────────────────────────────────────────────────────────────
// EmailShellInput — the branded shell input
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input to `renderEmailShell()`.
 *
 * The shell owns the AMPL logo header, table-based layout, inline styles, and
 * typography. Consumers supply the locale, an optional preheader, a heading,
 * and an ordered list of content blocks. The compliance footer is NOT part of
 * this input — it is stamped by the Worker's `deliver()` function after the
 * shell is rendered.
 *
 * Fields:
 *   - `locale`    — "en" or "es"; selects chrome strings (if any) in the shell.
 *   - `preheader` — optional inbox-preview text (hidden `<div>` at top of html).
 *                   When omitted the shell renders no preheader element.
 *   - `heading`   — visible heading rendered above the block content.
 *   - `blocks`    — ordered content blocks (see `EmailBlock`).
 *   - `logoUrl`   — optional override for the AMPL logo `<img src>`. When
 *                   present the shell uses this URL as the logo source. When
 *                   omitted the shell falls back to the module-level
 *                   `DEFAULT_AMPL_LOGO_URL` constant defined in `shell.ts`.
 *                   This is the only host coupling in kit, kept overridable by
 *                   consumers and tests.
 */
export interface EmailShellInput {
  locale: "en" | "es";
  preheader?: string;
  heading: string;
  blocks: EmailBlock[];
  /** Optional override for the AMPL logo source URL. Omit to use the default. */
  logoUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// IcsEvent — iCalendar event model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single iCalendar event passed to `buildIcs()`.
 *
 * Represents one VEVENT inside a VCALENDAR wrapper. `buildIcs` is pure — no
 * Worker, no network, no I/O. All date/time values are serialized to UTC form
 * (`YYYYMMDDTHHmmssZ`); no VTIMEZONE blocks are emitted.
 *
 * Fields:
 *   - `uid`         — stable identifier for this logical booking. Must be the
 *                     same across a REQUEST and its subsequent CANCEL for
 *                     calendar clients to correlate the two events and remove
 *                     the cancelled entry rather than adding a duplicate.
 *                     Recommended form: `<booking-id>@ampl.tools`.
 *   - `sequence`    — integer that MUST be 0 on the initial REQUEST and
 *                     strictly incremented (typically to 1) for each CANCEL or
 *                     update. Calendar clients use SEQUENCE to resolve the
 *                     ordering of multiple sends for the same UID.
 *   - `method`      — iTIP method: `"REQUEST"` for confirmation / reminder /
 *                     poll-finalisation (STATUS:CONFIRMED); `"CANCEL"` for
 *                     cancellations (STATUS:CANCELLED).
 *   - `summary`     — event title; TEXT-escaped per RFC 5545 §3.3.11.
 *   - `description` — optional long description; TEXT-escaped.
 *   - `location`    — optional location string; TEXT-escaped.
 *   - `dtstart`     — event start (UTC `Date`).
 *   - `dtend`       — event end (UTC `Date`).
 *   - `dtstamp`     — optional creation timestamp; defaults to `new Date()` in
 *                     `buildIcs` when omitted.
 *   - `organizer`   — event organizer. `name` is optional; `email` is required.
 *   - `attendees`   — list of attendees (at least one expected). Same shape as
 *                     `organizer`.
 *   - `url`         — optional booking URL; emitted as a `URL:` property.
 *
 * No RRULE / recurrence. Single events only.
 */
export interface IcsEvent {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  summary: string;
  description?: string;
  location?: string;
  dtstart: Date;
  dtend: Date;
  dtstamp?: Date;
  organizer: { name?: string; email: string };
  attendees: { name?: string; email: string }[];
  url?: string;
}
