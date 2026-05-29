/**
 * RFC 5545 iCalendar (.ics) builder
 *
 * This module exports a single pure function `buildIcs(event: IcsEvent): string`
 * that turns a typed `IcsEvent` into a conformant RFC 5545 VCALENDAR string
 * suitable for use as a calendar attachment.
 *
 * Invariants:
 *   - `buildIcs` is a PURE function — no Worker, no network, no I/O.
 *   - All line endings are CRLF (\r\n) per RFC 5545 §3.1.
 *   - TEXT values (SUMMARY, DESCRIPTION, LOCATION) are RFC 5545–escaped: the
 *     backslash is escaped first, then comma, then semicolon, then newlines.
 *   - Lines are folded at 75 octets using a TextEncoder-aware split that never
 *     splits inside a UTF-8 multi-byte sequence (RFC 5545 §3.1).
 *   - DTSTART/DTEND are serialized as UTC (…Z form, no VTIMEZONE block).
 *   - METHOD:REQUEST → STATUS:CONFIRMED; METHOD:CANCEL → STATUS:CANCELLED.
 *   - No RRULE / recurrence; single events only.
 *
 * Named exports only. No default export.
 *
 * @version v0.2.0
 */

import type { IcsEvent } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape a TEXT-type property value per RFC 5545 §3.3.11.
 *
 * The order matters: backslash must be escaped first to avoid double-escaping
 * the backslashes that are introduced by the subsequent replacements.
 *
 *   \ → \\
 *   , → \,
 *   ; → \;
 *   \r?\n → \n  (literal backslash + n, per RFC 5545; the physical line break
 *                is produced by foldLine, not by a raw newline in the value)
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\") // \ → \\ (MUST be first)
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Strip CR and LF characters from a raw field value that is not a TEXT
 * property — e.g. UID, URL, and email addresses.
 *
 * RFC 5545 content lines are delimited by CRLF; an unescaped newline in any
 * non-TEXT property terminates the current property line and injects new
 * calendar content. Stripping CR/LF removes that injection vector.
 */
function stripNewlines(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Wrap a CAL-ADDRESS parameter value (CN=) per RFC 5545 §3.2.
 *
 * Parameter values that contain `:`, `;`, `,`, or `"` MUST be DQUOTE-wrapped.
 * Any embedded DQUOTEs are stripped (they would break the quoted-string syntax).
 * CR/LF are stripped unconditionally to prevent property-line injection.
 */
function escapeParam(value: string): string {
  const cleaned = value.replace(/[\r\n]/g, "");
  // Always DQUOTE-wrap CN values: simpler and always safe per RFC 5545 §3.2
  return `"${cleaned.replace(/"/g, "")}"`;
}

/**
 * Fold a content line at 75 octets, appending CRLF at the end of each chunk.
 *
 * RFC 5545 §3.1: "Lines of text SHOULD NOT be longer than 75 octets, excluding
 * the line break. Long content lines SHOULD be split into a multiple line
 * representations using a line 'folding' technique. That is, a long line can be
 * split between any two characters by inserting a CRLF immediately followed by a
 * single linear white-space character."
 *
 * The first line may be up to 75 bytes. Each continuation line has 1 byte taken
 * by the leading space, so continuations carry at most 74 bytes of content.
 *
 * Multi-byte UTF-8 sequences are never split: the algorithm backs up past any
 * continuation bytes ((byte & 0xc0) === 0x80) before marking the split point.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(line);

  if (bytes.byteLength <= 75) {
    return line + "\r\n";
  }

  const chunks: string[] = [];
  let offset = 0;
  let first = true;

  while (offset < bytes.byteLength) {
    const limit = first ? 75 : 74;
    let end = Math.min(offset + limit, bytes.byteLength);

    // Back up to avoid splitting inside a multi-byte UTF-8 sequence
    while (end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    chunks.push((first ? "" : " ") + decoder.decode(bytes.slice(offset, end)));
    offset = end;
    first = false;
  }

  return chunks.join("\r\n") + "\r\n";
}

/**
 * Serialize a Date to the RFC 5545 UTC date-time form: YYYYMMDDTHHmmssZ.
 *
 * Example: new Date("2026-06-15T10:00:00Z") → "20260615T100000Z"
 */
function formatDateTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "") // "2026-06-15T10:00:00.000Z" → "20260615T100000.000Z"
    .replace(/\.\d{3}/, ""); // remove milliseconds → "20260615T100000Z"
}

// ─────────────────────────────────────────────────────────────────────────────
// Public export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a conformant RFC 5545 VCALENDAR string from the given `IcsEvent`.
 *
 * The returned string is ready to be base64-encoded and attached to an email
 * with content-type `text/calendar; charset=utf-8; method=<event.method>`.
 *
 * The function is pure: it reads only the supplied `event` object and
 * `event.dtstamp ?? new Date()` for the generation timestamp. No I/O, no
 * network, no Worker dependencies.
 *
 * @param event - The iCalendar event descriptor (see IcsEvent in types.ts)
 * @returns A complete VCALENDAR string with CRLF line endings
 */
export function buildIcs(event: IcsEvent): string {
  // ── Input validation ──────────────────────────────────────────────────────

  // Reject invalid Date objects before toISOString() can throw a cryptic
  // RangeError — emit a clear contract-level error message instead.
  if (Number.isNaN(event.dtstart.getTime())) {
    throw new Error("buildIcs: invalid date — dtstart is not a valid Date");
  }
  if (Number.isNaN(event.dtend.getTime())) {
    throw new Error("buildIcs: invalid date — dtend is not a valid Date");
  }
  if (event.dtstamp !== undefined && Number.isNaN(event.dtstamp.getTime())) {
    throw new Error("buildIcs: invalid date — dtstamp is not a valid Date");
  }

  // At least one attendee is required for METHOD:REQUEST and METHOD:CANCEL
  // (iTIP semantics; emitting zero ATTENDEE lines produces a malformed VEVENT).
  if (event.attendees.length === 0) {
    throw new Error("buildIcs: at least one attendee required");
  }

  // dtend must not precede dtstart — calendar clients silently misbehave
  // when an event has negative duration.
  if (event.dtend.getTime() < event.dtstart.getTime()) {
    throw new Error("buildIcs: dtend must be >= dtstart");
  }

  // sequence must be a non-negative integer; floats and NaN corrupt iTIP
  // ordering and render as literal "NaN" or "0.5" in the SEQUENCE property.
  if (!Number.isInteger(event.sequence) || event.sequence < 0) {
    throw new Error("buildIcs: sequence must be a non-negative integer");
  }

  const dtstamp = event.dtstamp ?? new Date();
  const status = event.method === "CANCEL" ? "CANCELLED" : "CONFIRMED";

  // Helper: fold a "PROPERTY:value" pair and accumulate onto the lines array
  const line = (prop: string): string => foldLine(prop);

  // Build VCALENDAR header lines
  const vcalHeader: string[] = [
    line("BEGIN:VCALENDAR"),
    line("VERSION:2.0"),
    line("PRODID:-//AMPL//ampl.tools//EN"),
    line("CALSCALE:GREGORIAN"),
    line(`METHOD:${event.method}`),
  ];

  // Build VEVENT lines
  const vevent: string[] = [line("BEGIN:VEVENT")];

  vevent.push(line(`UID:${stripNewlines(event.uid)}`));
  vevent.push(line(`SEQUENCE:${event.sequence}`));
  vevent.push(line(`STATUS:${status}`));
  vevent.push(line(`DTSTAMP:${formatDateTime(dtstamp)}`));
  vevent.push(line(`DTSTART:${formatDateTime(event.dtstart)}`));
  vevent.push(line(`DTEND:${formatDateTime(event.dtend)}`));
  vevent.push(line(`SUMMARY:${escapeText(event.summary)}`));

  if (event.description !== undefined) {
    vevent.push(line(`DESCRIPTION:${escapeText(event.description)}`));
  }

  if (event.location !== undefined) {
    vevent.push(line(`LOCATION:${escapeText(event.location)}`));
  }

  // ORGANIZER in CAL-ADDRESS form (RFC 5546 §3.2.2).
  // CN parameter values are DQUOTE-wrapped per RFC 5545 §3.2 (escapeParam),
  // and email addresses have CR/LF stripped to prevent property-line injection.
  if (event.organizer.name !== undefined && event.organizer.name !== "") {
    vevent.push(line(`ORGANIZER;CN=${escapeParam(event.organizer.name)}:mailto:${stripNewlines(event.organizer.email)}`));
  } else {
    vevent.push(line(`ORGANIZER:mailto:${stripNewlines(event.organizer.email)}`));
  }

  // ATTENDEE lines in CAL-ADDRESS form
  for (const attendee of event.attendees) {
    if (attendee.name !== undefined && attendee.name !== "") {
      vevent.push(line(`ATTENDEE;CN=${escapeParam(attendee.name)}:mailto:${stripNewlines(attendee.email)}`));
    } else {
      vevent.push(line(`ATTENDEE:mailto:${stripNewlines(attendee.email)}`));
    }
  }

  // Optional URL — strip CR/LF to prevent property-line injection
  if (event.url !== undefined) {
    vevent.push(line(`URL:${stripNewlines(event.url)}`));
  }

  vevent.push(line("END:VEVENT"));

  // Close VCALENDAR
  const vcalFooter: string[] = [line("END:VCALENDAR")];

  return [...vcalHeader, ...vevent, ...vcalFooter].join("");
}
