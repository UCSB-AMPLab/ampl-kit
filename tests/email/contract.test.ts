/**
 * send() consumer contract integration tests
 *
 * Tests the full send() pipeline for both AMPL email consumer shapes:
 * Calamus (bilingual invitation) and Scheduling (confirmation / cancellation /
 * poll-finalisation / reminder with .ics attachments). Uses the EMAIL_DB
 * harness and a fake Resend transport — mirrors send.test.ts exactly.
 *
 * Each test case stubs the global `fetch` to intercept the POST to
 * `https://api.resend.com/emails` so no real network call is made.
 *
 * Cases covered:
 *   1. Calamus bilingual invitation — en locale: send() succeeds, Worker
 *      stamps <!--ampl-footer--> in html.
 *   2. Calamus bilingual invitation — es locale: distinct idempotencyKey
 *      prevents the idempotency gate from rejecting the second call.
 *   3. Scheduling confirmation: attachments[0].content is valid base64 that
 *      atob-decodes to BEGIN:VCALENDAR / METHOD:REQUEST / STATUS:CONFIRMED.
 *   4. Scheduling cancellation: attachment content_type carries method=CANCEL;
 *      decoded .ics contains STATUS:CANCELLED.
 *   5. Poll-finalisation and reminder: both route through send() with a REQUEST
 *      .ics attachment present.
 *
 * Expected to run RED until kit/email barrel + deliver() attachment wiring
 * (Waves 1/2) land.
 *
 * @version v0.2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { getEmailDb } from "../helpers/email-db";
import { renderEmailShell, buildIcs } from "../../kit/email";
import type { EmailShellInput } from "../../kit/email/types";
import type { SendMessage } from "../../app/email/types";

// ---------------------------------------------------------------------------
// Resend fetch fake helpers (mirrors send.test.ts exactly)
// ---------------------------------------------------------------------------

type ResendPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  attachments?: Array<{
    content: string;
    filename: string;
    content_type: string;
    content_id?: string;
  }>;
};

let resendCalls: ResendPayload[] = [];

const FAKE_RESEND_ID = "resend-fake-id-contract-001";

function installResendFake() {
  resendCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.resend.com/emails") {
        const body = JSON.parse((init?.body as string) ?? "{}") as ResendPayload;
        resendCalls.push(body);
        return new Response(JSON.stringify({ id: FAKE_RESEND_ID }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    }),
  );
}

function uninstallResendFake() {
  vi.unstubAllGlobals();
}

// ---------------------------------------------------------------------------
// Helpers — build fixtures using kit/email functions
// ---------------------------------------------------------------------------

function buildCalamusInviteMsg(locale: "en" | "es", idempotencyKey?: string): SendMessage {
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
              url: "https://ampl.tools/palaeography/invite/fixture-abc",
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
              url: "https://ampl.tools/palaeography/invite/fixture-abc",
            },
            { kind: "note", content: "Esta invitación expira en 14 días." },
          ],
        };

  const { html, text } = renderEmailShell(input);
  const msg: SendMessage = {
    to: "user@example.com",
    subject: "[Calamus] Invitation to practice group",
    html,
    text,
    tool: "calamus",
    locale,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
  return msg;
}

/** Build a Scheduling .ics attachment string using buildIcs. */
function buildIcsAttachment(
  method: "REQUEST" | "CANCEL",
  sequence: number,
): { content: string; filename: string; type: string } {
  const content = buildIcs({
    uid: "booking-fixture-001@ampl.tools",
    sequence,
    method,
    summary: "Lab consultation",
    dtstart: new Date("2026-06-15T10:00:00Z"),
    dtend: new Date("2026-06-15T11:00:00Z"),
    organizer: { email: "noreply@ampl.tools", name: "AMPL" },
    attendees: [{ email: "user@example.com", name: "User" }],
  });
  return {
    content,
    filename: "event.ics",
    type: `text/calendar; charset=utf-8; method=${method}`,
  };
}

function buildSchedulingMsg(
  subject: string,
  method: "REQUEST" | "CANCEL",
  sequence: number,
): SendMessage {
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
  const att = buildIcsAttachment(method, sequence);
  return {
    to: "user@example.com",
    subject: `[Scheduling] ${subject}`,
    html,
    text,
    tool: "scheduling",
    attachments: [att],
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("send() consumer contract", () => {
  let db: ReturnType<typeof getEmailDb>;

  beforeEach(() => {
    db = getEmailDb();
    installResendFake();
  });

  afterEach(() => {
    uninstallResendFake();
  });

  // -------------------------------------------------------------------------
  // 1. Calamus bilingual invitation — EN
  // -------------------------------------------------------------------------
  it("Calamus en invitation: send() succeeds and Worker stamps <!--ampl-footer--> in html", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const msg = buildCalamusInviteMsg("en", "calamus-invite-en-fixture");
    const result = await worker.send(msg);

    expect(result.ok).toBe(true);
    expect(resendCalls).toHaveLength(1);
    // Worker's deliver() appends buildFooter(locale) → <!--ampl-footer--> is stamped
    expect(resendCalls[0].html).toContain("<!--ampl-footer-->");
  });

  // -------------------------------------------------------------------------
  // 2. Calamus bilingual invitation — ES (distinct idempotencyKey)
  //    Note: distinct key avoids the idempotency gate rejecting this as a duplicate.
  // -------------------------------------------------------------------------
  it("Calamus es invitation: send() succeeds with distinct idempotencyKey", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    // EN call first (different key)
    await worker.send(buildCalamusInviteMsg("en", "calamus-invite-en-fixture-2"));

    // ES call with a different key — must not be rejected as duplicate
    const msg = buildCalamusInviteMsg("es", "calamus-invite-es-fixture");
    const result = await worker.send(msg);

    expect(result.ok).toBe(true);
    expect(resendCalls).toHaveLength(2);
    // ES footer copy present in the second call's html
    expect(resendCalls[1].html).toContain("<!--ampl-footer-->");
  });

  // -------------------------------------------------------------------------
  // 3. Scheduling confirmation with REQUEST .ics attachment
  // -------------------------------------------------------------------------
  it("Scheduling confirmation: attachments[0].content base64-decodes to BEGIN:VCALENDAR / METHOD:REQUEST / STATUS:CONFIRMED", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const msg = buildSchedulingMsg("Appointment confirmed", "REQUEST", 0);
    const result = await worker.send(msg);

    expect(result.ok).toBe(true);
    expect(resendCalls).toHaveLength(1);

    const att = resendCalls[0].attachments;
    expect(att).toHaveLength(1);
    expect(att![0].filename).toBe("event.ics");
    expect(att![0].content_type).toBe("text/calendar; charset=utf-8; method=REQUEST");

    // Decode base64 and assert valid VCALENDAR content
    const decoded = atob(att![0].content);
    expect(decoded).toContain("BEGIN:VCALENDAR");
    expect(decoded).toContain("METHOD:REQUEST");
    expect(decoded).toContain("STATUS:CONFIRMED");
  });

  // -------------------------------------------------------------------------
  // 4. Scheduling cancellation with CANCEL .ics attachment
  // -------------------------------------------------------------------------
  it("Scheduling cancellation: content_type method=CANCEL and decoded .ics contains STATUS:CANCELLED", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const msg = buildSchedulingMsg("Appointment cancelled", "CANCEL", 1);
    const result = await worker.send(msg);

    expect(result.ok).toBe(true);
    expect(resendCalls).toHaveLength(1);

    const att = resendCalls[0].attachments;
    expect(att).toHaveLength(1);
    // content_type must carry method=CANCEL
    expect(att![0].content_type).toBe("text/calendar; charset=utf-8; method=CANCEL");

    const decoded = atob(att![0].content);
    expect(decoded).toContain("BEGIN:VCALENDAR");
    expect(decoded).toContain("METHOD:CANCEL");
    expect(decoded).toContain("STATUS:CANCELLED");
  });

  // -------------------------------------------------------------------------
  // 5a. Poll-finalisation fixture — routes with a REQUEST .ics attachment
  // -------------------------------------------------------------------------
  it("Scheduling poll-finalisation: routes through send() with a REQUEST .ics attachment", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const shellInput: EmailShellInput = {
      locale: "en",
      heading: "Your poll result is in — appointment confirmed",
      blocks: [
        { kind: "text", content: "The poll for your group meeting has closed. Your appointment is confirmed." },
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
    const att = buildIcsAttachment("REQUEST", 0);
    const msg: SendMessage = {
      to: "user@example.com",
      subject: "[Scheduling] Poll result",
      html,
      text,
      tool: "scheduling",
      attachments: [att],
    };

    const result = await worker.send(msg);
    expect(result.ok).toBe(true);
    expect(resendCalls).toHaveLength(1);

    const sentAtt = resendCalls[0].attachments;
    expect(sentAtt).toHaveLength(1);
    const decoded = atob(sentAtt![0].content);
    expect(decoded).toContain("BEGIN:VCALENDAR");
    expect(decoded).toContain("METHOD:REQUEST");
  });

  // -------------------------------------------------------------------------
  // 5b. Reminder fixture — routes with a REQUEST .ics attachment
  // -------------------------------------------------------------------------
  it("Scheduling reminder: routes through send() with a REQUEST .ics attachment", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    const shellInput: EmailShellInput = {
      locale: "en",
      heading: "Reminder: your appointment is coming up",
      blocks: [
        { kind: "text", content: "This is a reminder that your appointment is tomorrow." },
        {
          kind: "details",
          rows: [
            { label: "Date", value: "June 15, 2026" },
            { label: "Time", value: "10:00 AM" },
          ],
        },
        { kind: "note", content: "The .ics file is attached for your calendar." },
      ],
    };
    const { html, text } = renderEmailShell(shellInput);
    const att = buildIcsAttachment("REQUEST", 0);
    const msg: SendMessage = {
      to: "user@example.com",
      subject: "[Scheduling] Appointment reminder",
      html,
      text,
      tool: "scheduling",
      attachments: [att],
    };

    const result = await worker.send(msg);
    expect(result.ok).toBe(true);
    expect(resendCalls).toHaveLength(1);

    const sentAtt = resendCalls[0].attachments;
    expect(sentAtt).toHaveLength(1);
    const decoded = atob(sentAtt![0].content);
    expect(decoded).toContain("BEGIN:VCALENDAR");
    expect(decoded).toContain("METHOD:REQUEST");
  });

  // -------------------------------------------------------------------------
  // 6. ArrayBuffer attachment content — encodeBase64 ArrayBuffer branch
  //    Exercises the `new Uint8Array(content)` path (workers/email.ts line 67)
  //    which no existing test reaches (all prior cases pass string content).
  // -------------------------------------------------------------------------
  it("ArrayBuffer attachment content round-trips through encodeBase64 correctly", async () => {
    const worker = new (
      await import("../../workers/email")
    ).default({} as unknown as ExecutionContext, env);

    // Build a known byte sequence via TextEncoder and extract its ArrayBuffer.
    // This simulates a binary attachment (e.g. a PDF or compiled binary blob)
    // passed as raw bytes rather than a string.
    const knownText = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";
    const originalBytes = new TextEncoder().encode(knownText);
    const arrayBufferContent: ArrayBuffer = originalBytes.buffer;

    const shellInput: EmailShellInput = {
      locale: "en",
      heading: "Binary attachment test",
      blocks: [{ kind: "text", content: "This message carries an ArrayBuffer attachment." }],
    };
    const { html, text } = renderEmailShell(shellInput);

    // Use a distinct idempotencyKey so the idempotency gate does not
    // reject this as a duplicate of another test in this suite (mirrors case 2).
    const msg: SendMessage = {
      to: "user@example.com",
      subject: "[Scheduling] ArrayBuffer attachment fixture",
      html,
      text,
      tool: "scheduling",
      idempotencyKey: "email-03-arraybuffer-fixture",
      attachments: [
        {
          content: arrayBufferContent,
          filename: "event.ics",
          type: "text/calendar; charset=utf-8; method=REQUEST",
        },
      ],
    };

    const result = await worker.send(msg);

    expect(result.ok).toBe(true);
    expect(resendCalls).toHaveLength(1);

    const sentAtt = resendCalls[0].attachments;
    expect(sentAtt).toHaveLength(1);
    expect(sentAtt![0].filename).toBe("event.ics");

    // Round-trip: atob() the base64 the Worker produced and verify byte-for-byte
    // equality against the original ArrayBuffer content.
    const base64Sent = sentAtt![0].content;
    const decodedString = atob(base64Sent);
    const decodedBytes = new Uint8Array(decodedString.length);
    for (let i = 0; i < decodedString.length; i++) {
      decodedBytes[i] = decodedString.charCodeAt(i);
    }

    expect(decodedBytes).toEqual(originalBytes);
  });
});
