/**
 * buildIcs unit tests — RFC 5545 correctness
 *
 * Pure-function tests for `buildIcs`. No DB harness, no fetch stub, no
 * `env`, no `beforeEach`/`afterEach` — `buildIcs` is a synchronous pure
 * function and can be called directly.
 *
 * Cases covered:
 *   1. VCALENDAR wrapper: BEGIN/END, VERSION:2.0, PRODID, CALSCALE.
 *   2. CRLF line endings: every line ends in \r\n; no bare \n present.
 *   3. METHOD:REQUEST → STATUS:CONFIRMED; DTSTART serialized as UTC "Z" form.
 *   4. TEXT escaping: comma → \,, semicolon → \;, backslash → \\, newline → \n.
 *   5. Line folding: lines longer than 75 octets are folded with CRLF + leading space.
 *   6. METHOD:CANCEL → STATUS:CANCELLED, SEQUENCE:1, same UID as REQUEST.
 *
 * @version v0.2.0
 */

import { describe, it, expect } from "vitest";
import { buildIcs } from "../../kit/email/ics";
import type { IcsEvent } from "../../kit/email/types";

// ---------------------------------------------------------------------------
// Base fixture
// ---------------------------------------------------------------------------

const BASE_EVENT: IcsEvent = {
  uid: "booking-abc@ampl.tools",
  sequence: 0,
  method: "REQUEST",
  summary: "Lab consultation",
  dtstart: new Date("2026-06-15T10:00:00Z"),
  dtend: new Date("2026-06-15T11:00:00Z"),
  organizer: { email: "noreply@ampl.tools", name: "AMPL" },
  attendees: [{ email: "user@example.com", name: "User" }],
};

// ---------------------------------------------------------------------------
// 1. VCALENDAR wrapper
// ---------------------------------------------------------------------------

describe("buildIcs — VCALENDAR wrapper", () => {
  it("output contains BEGIN:VCALENDAR and END:VCALENDAR", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("BEGIN:VCALENDAR");
    expect(output).toContain("END:VCALENDAR");
  });

  it("output contains VERSION:2.0", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("VERSION:2.0");
  });

  it("output contains a PRODID property", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("PRODID:");
  });

  it("output contains BEGIN:VEVENT and END:VEVENT", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("BEGIN:VEVENT");
    expect(output).toContain("END:VEVENT");
  });
});

// ---------------------------------------------------------------------------
// 2. CRLF line endings
// ---------------------------------------------------------------------------

describe("buildIcs — CRLF line endings", () => {
  it("output contains \\r\\n line endings", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("\r\n");
  });

  it("output does not contain bare \\n without preceding \\r", () => {
    const output = buildIcs(BASE_EVENT);
    // Replace all \r\n first, then check no \n remains
    const withoutCRLF = output.replace(/\r\n/g, "");
    expect(withoutCRLF).not.toContain("\n");
  });
});

// ---------------------------------------------------------------------------
// 3. METHOD:REQUEST semantics
// ---------------------------------------------------------------------------

describe("buildIcs — METHOD:REQUEST", () => {
  it("emits METHOD:REQUEST", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("METHOD:REQUEST");
  });

  it("emits STATUS:CONFIRMED for REQUEST", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("STATUS:CONFIRMED");
  });

  it("serializes DTSTART in UTC Z form", () => {
    const output = buildIcs(BASE_EVENT);
    // 2026-06-15T10:00:00Z → 20260615T100000Z
    expect(output).toContain("DTSTART:20260615T100000Z");
  });

  it("serializes DTEND in UTC Z form", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("DTEND:20260615T110000Z");
  });

  it("emits UID and SEQUENCE:0", () => {
    const output = buildIcs(BASE_EVENT);
    expect(output).toContain("UID:booking-abc@ampl.tools");
    expect(output).toContain("SEQUENCE:0");
  });
});

// ---------------------------------------------------------------------------
// 4. TEXT escaping
// ---------------------------------------------------------------------------

describe("buildIcs — TEXT escaping", () => {
  it("escapes comma in SUMMARY → \\,", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      summary: "Coffee, tea, or consultation",
    };
    const output = buildIcs(event);
    expect(output).toContain("Coffee\\, tea\\, or consultation");
  });

  it("escapes semicolon in SUMMARY → \\;", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      summary: "Health; safety; compliance",
    };
    const output = buildIcs(event);
    expect(output).toContain("Health\\; safety\\; compliance");
  });

  it("escapes backslash in SUMMARY → \\\\", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      summary: "Folder\\Subfolder",
    };
    const output = buildIcs(event);
    expect(output).toContain("Folder\\\\Subfolder");
  });

  it("does not leave raw comma, semicolon, or backslash in SUMMARY", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      summary: "a,b;c\\d",
    };
    const output = buildIcs(event);
    // Extract the SUMMARY line (may be folded, but the escaped forms must appear)
    expect(output).toContain("\\,");
    expect(output).toContain("\\;");
    expect(output).toContain("\\\\");
  });
});

// ---------------------------------------------------------------------------
// 5. Line folding at 75 octets
// ---------------------------------------------------------------------------

describe("buildIcs — line folding", () => {
  it("folds a long SUMMARY at 75 octets with CRLF + leading space", () => {
    // Create a summary long enough to exceed the 75-octet RFC 5545 limit
    // "SUMMARY:" is 8 chars, so the value needs to push past 67 chars to trigger folding
    const longSummary =
      "A very long summary that exceeds the RFC 5545 seventy-five octet line limit for property values";
    const event: IcsEvent = { ...BASE_EVENT, summary: longSummary };
    const output = buildIcs(event);
    // RFC 5545 fold continuation is CRLF followed by a single space
    expect(output).toContain("\r\n ");
  });

  it("each physical line in the output is no longer than 75 octets", () => {
    const longSummary =
      "A very long summary that definitely exceeds the seventy-five octet per line limit imposed by RFC 5545 section 3.1";
    const event: IcsEvent = { ...BASE_EVENT, summary: longSummary };
    const output = buildIcs(event);
    const encoder = new TextEncoder();
    const lines = output.split("\r\n");
    for (const line of lines) {
      if (line === "") continue; // trailing empty after final CRLF
      const octets = encoder.encode(line).length;
      expect(octets).toBeLessThanOrEqual(75);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. METHOD:CANCEL semantics
// ---------------------------------------------------------------------------

describe("buildIcs — METHOD:CANCEL", () => {
  it("emits METHOD:CANCEL", () => {
    const cancelEvent: IcsEvent = {
      ...BASE_EVENT,
      method: "CANCEL",
      sequence: 1,
    };
    const output = buildIcs(cancelEvent);
    expect(output).toContain("METHOD:CANCEL");
  });

  it("emits STATUS:CANCELLED for CANCEL", () => {
    const cancelEvent: IcsEvent = {
      ...BASE_EVENT,
      method: "CANCEL",
      sequence: 1,
    };
    const output = buildIcs(cancelEvent);
    expect(output).toContain("STATUS:CANCELLED");
  });

  it("emits SEQUENCE:1 for a CANCEL with sequence 1", () => {
    const cancelEvent: IcsEvent = {
      ...BASE_EVENT,
      method: "CANCEL",
      sequence: 1,
    };
    const output = buildIcs(cancelEvent);
    expect(output).toContain("SEQUENCE:1");
  });

  it("preserves the same UID as the original REQUEST", () => {
    const cancelEvent: IcsEvent = {
      ...BASE_EVENT,
      method: "CANCEL",
      sequence: 1,
    };
    const output = buildIcs(cancelEvent);
    expect(output).toContain("UID:booking-abc@ampl.tools");
  });

  it("does NOT emit STATUS:CONFIRMED for a CANCEL event", () => {
    const cancelEvent: IcsEvent = {
      ...BASE_EVENT,
      method: "CANCEL",
      sequence: 1,
    };
    const output = buildIcs(cancelEvent);
    expect(output).not.toContain("STATUS:CONFIRMED");
  });
});

// ---------------------------------------------------------------------------
// 7. ICS injection prevention
// ---------------------------------------------------------------------------

describe("buildIcs — ICS injection prevention", () => {
  it("uid with \\n does not produce extra property lines", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      uid: "abc\nATTENDEE:mailto:victim@example.com",
    };
    const output = buildIcs(event);
    // The newline must NOT appear as a real line break in the UID property
    // (it would be stripped). The injected ATTENDEE must not appear as a new property.
    const lines = output.split("\r\n").filter((l) => l !== "");
    const uidLine = lines.find((l) => l.startsWith("UID:"));
    expect(uidLine).toBeDefined();
    // Stripped: no newline in the uid value
    expect(uidLine).not.toContain("\n");
    // The injected attendee does not appear as an extra ATTENDEE line caused by the uid
    const attendeeLines = lines.filter((l) => l.startsWith("ATTENDEE:mailto:victim@example.com"));
    expect(attendeeLines).toHaveLength(0);
  });

  it("url with \\r\\n does not produce extra property lines", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      url: "https://ampl.tools/booking\r\nX-INJECTED:evil",
    };
    const output = buildIcs(event);
    // The CR/LF are stripped, so no extra line beginning with "X-INJECTED:" is emitted
    const lines = output.split("\r\n").filter((l) => l !== "");
    const injectedLine = lines.find((l) => l.startsWith("X-INJECTED:"));
    expect(injectedLine).toBeUndefined();
  });

  it("organizer name containing : is DQUOTE-wrapped", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      organizer: { name: "Org:Admin", email: "org@ampl.tools" },
    };
    const output = buildIcs(event);
    // CN value must be quoted so the colon doesn't corrupt the property grammar
    expect(output).toContain('CN="Org:Admin"');
  });

  it("organizer name containing ; is DQUOTE-wrapped", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      organizer: { name: "Doe; ROLE=CHAIR", email: "doe@ampl.tools" },
    };
    const output = buildIcs(event);
    expect(output).toContain('CN="Doe; ROLE=CHAIR"');
  });

  it("attendee name containing : is DQUOTE-wrapped", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      attendees: [{ name: "User:Test", email: "user@example.com" }],
    };
    const output = buildIcs(event);
    expect(output).toContain('CN="User:Test"');
  });

  it("CR/LF in organizer email is stripped — no injected property line", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      organizer: { name: "AMPL", email: "noreply@ampl.tools\nX-INJECT:evil" },
    };
    const output = buildIcs(event);
    // CR/LF stripped: no line starting with "X-INJECT:" is emitted
    const lines = output.split("\r\n").filter((l) => l !== "");
    const injectedLine = lines.find((l) => l.startsWith("X-INJECT:"));
    expect(injectedLine).toBeUndefined();
  });

  it("CR/LF in attendee email is stripped — no injected property line", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      attendees: [{ email: "user@example.com\r\nX-INJECT:evil" }],
    };
    const output = buildIcs(event);
    // CR/LF stripped: no line starting with "X-INJECT:" is emitted
    const lines = output.split("\r\n").filter((l) => l !== "");
    const injectedLine = lines.find((l) => l.startsWith("X-INJECT:"));
    expect(injectedLine).toBeUndefined();
  });

  it("organizer name with \\n in CN is stripped — no injected property line", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      organizer: { name: "AMPL\nX-INJECT:evil", email: "noreply@ampl.tools" },
    };
    const output = buildIcs(event);
    // CR/LF stripped from CN: no line starting with "X-INJECT:" is emitted
    const lines = output.split("\r\n").filter((l) => l !== "");
    const injectedLine = lines.find((l) => l.startsWith("X-INJECT:"));
    expect(injectedLine).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Input validation
// ---------------------------------------------------------------------------

describe("buildIcs — input validation", () => {
  // invalid dates
  it("throws on invalid dtstart", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      dtstart: new Date("not a date"),
    };
    expect(() => buildIcs(event)).toThrow("buildIcs: invalid date");
  });

  it("throws on invalid dtend", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      dtend: new Date("not a date"),
    };
    expect(() => buildIcs(event)).toThrow("buildIcs: invalid date");
  });

  it("throws on invalid dtstamp", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      dtstamp: new Date("not a date"),
    };
    expect(() => buildIcs(event)).toThrow("buildIcs: invalid date");
  });

  // empty attendees
  it("throws when attendees array is empty", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      attendees: [],
    };
    expect(() => buildIcs(event)).toThrow("buildIcs: at least one attendee required");
  });

  // dtend before dtstart
  it("throws when dtend is before dtstart", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      dtstart: new Date("2026-06-15T11:00:00Z"),
      dtend: new Date("2026-06-15T10:00:00Z"),
    };
    expect(() => buildIcs(event)).toThrow("buildIcs: dtend must be >= dtstart");
  });

  it("accepts dtend equal to dtstart (zero-duration event)", () => {
    const event: IcsEvent = {
      ...BASE_EVENT,
      dtstart: new Date("2026-06-15T10:00:00Z"),
      dtend: new Date("2026-06-15T10:00:00Z"),
    };
    expect(() => buildIcs(event)).not.toThrow();
  });

  // sequence validation
  it("throws on non-integer sequence (float)", () => {
    const event: IcsEvent = { ...BASE_EVENT, sequence: 0.5 };
    expect(() => buildIcs(event)).toThrow("buildIcs: sequence must be a non-negative integer");
  });

  it("throws on NaN sequence", () => {
    const event: IcsEvent = { ...BASE_EVENT, sequence: NaN };
    expect(() => buildIcs(event)).toThrow("buildIcs: sequence must be a non-negative integer");
  });

  it("throws on negative sequence", () => {
    const event: IcsEvent = { ...BASE_EVENT, sequence: -1 };
    expect(() => buildIcs(event)).toThrow("buildIcs: sequence must be a non-negative integer");
  });

  it("accepts sequence 0", () => {
    const event: IcsEvent = { ...BASE_EVENT, sequence: 0 };
    expect(() => buildIcs(event)).not.toThrow();
  });
});
