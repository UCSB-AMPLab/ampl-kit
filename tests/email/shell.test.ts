/**
 * renderEmailShell unit tests — bilingual shell output correctness
 *
 * Pure-function tests for `renderEmailShell`. No DB harness, no fetch stub,
 * no `env`, no `beforeEach`/`afterEach` — `renderEmailShell` is a synchronous
 * pure function returning `{ html, text }`.
 *
 * Cases covered:
 *   1. Non-empty output: both html and text are non-empty strings.
 *   2. Logo: html contains an <img element (AMPL logo header).
 *   3. Fragment, not document: html does NOT contain </html> (shell is a fragment).
 *   4. No compliance footer: html does NOT contain <!--ampl-footer-->.
 *   5. Text content: text contains the heading and at least one block's content.
 *   6. Preheader presence: when preheader is supplied, a preheader <div is in html.
 *   7. Preheader absence: when preheader is omitted, no preheader <div in html.
 *   8. Block kinds: button, details, and note blocks render to html without error.
 *   9. Locale: both "en" and "es" inputs render without error.
 *
 * @version v0.2.0
 */

import { describe, it, expect } from "vitest";
import { renderEmailShell } from "../../kit/email/shell";
import type { EmailShellInput } from "../../kit/email/types";

// ---------------------------------------------------------------------------
// Base fixtures
// ---------------------------------------------------------------------------

const BASE_EN: EmailShellInput = {
  locale: "en",
  preheader: "Your palaeography practice invitation",
  heading: "You're invited to Calamus",
  blocks: [
    { kind: "text", content: "You have been invited to join a palaeography practice group." },
    { kind: "button", label: "Accept invitation", url: "https://ampl.tools/palaeography/invite/abc" },
    { kind: "note", content: "This invitation expires in 14 days." },
  ],
};

const BASE_ES: EmailShellInput = {
  locale: "es",
  preheader: "Tu invitación a la práctica de paleografía",
  heading: "Estás invitado a Calamus",
  blocks: [
    { kind: "text", content: "Has sido invitado a unirte a un grupo de práctica paleográfica." },
    { kind: "button", label: "Aceptar invitación", url: "https://ampl.tools/palaeography/invite/abc" },
    { kind: "note", content: "Esta invitación expira en 14 días." },
  ],
};

const DETAILS_INPUT: EmailShellInput = {
  locale: "en",
  heading: "Appointment confirmed",
  blocks: [
    { kind: "text", content: "Your appointment has been confirmed." },
    {
      kind: "details",
      rows: [
        { label: "Date", value: "June 15, 2026" },
        { label: "Time", value: "10:00 AM" },
        { label: "Location", value: "Meeting Room A" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. Non-empty output
// ---------------------------------------------------------------------------

describe("renderEmailShell — non-empty output", () => {
  it("returns a non-empty html string", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).toBeTruthy();
  });

  it("returns a non-empty text string", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.text).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Logo
// ---------------------------------------------------------------------------

describe("renderEmailShell — logo", () => {
  it("html contains an <img element (AMPL logo)", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).toContain("<img");
  });

  it("logoUrl override is used as img src when provided", () => {
    const withLogo: EmailShellInput = {
      ...BASE_EN,
      logoUrl: "https://example.com/test-logo.png",
    };
    const result = renderEmailShell(withLogo);
    expect(result.html).toContain("https://example.com/test-logo.png");
  });
});

// ---------------------------------------------------------------------------
// 3. Fragment — no </html>
// ---------------------------------------------------------------------------

describe("renderEmailShell — HTML fragment (no document wrapper)", () => {
  it("html does NOT contain </html> (shell is a fragment, not a full document)", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).not.toContain("</html>");
  });

  it("html does NOT contain <!DOCTYPE", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).not.toContain("<!DOCTYPE");
  });

  it("html does NOT contain <html", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).not.toContain("<html");
  });
});

// ---------------------------------------------------------------------------
// 4. No compliance footer
// ---------------------------------------------------------------------------

describe("renderEmailShell — no compliance footer", () => {
  it("html does NOT contain <!--ampl-footer--> (footer is stamped by the Worker)", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).not.toContain("<!--ampl-footer-->");
  });

  it("html does NOT contain unsubscribe links", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).not.toMatch(/unsubscribe/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Text content
// ---------------------------------------------------------------------------

describe("renderEmailShell — text output", () => {
  it("text contains the heading", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.text).toContain(BASE_EN.heading);
  });

  it("text contains a text block's content", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.text).toContain("You have been invited to join a palaeography practice group.");
  });

  it("text contains a note block's content", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.text).toContain("This invitation expires in 14 days.");
  });
});

// ---------------------------------------------------------------------------
// 6. Preheader presence
// ---------------------------------------------------------------------------

describe("renderEmailShell — preheader", () => {
  it("html contains a preheader <div when preheader is supplied", () => {
    const result = renderEmailShell(BASE_EN);
    // The preheader is a hidden div at the top of the email body
    expect(result.html).toContain("Your palaeography practice invitation");
  });

  it("html contains the preheader text when preheader is supplied", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).toContain(BASE_EN.preheader!);
  });

  // ---------------------------------------------------------------------------
  // 7. Preheader absence
  // ---------------------------------------------------------------------------

  it("html does NOT contain the preheader text when preheader is omitted", () => {
    const noPreheader: EmailShellInput = {
      locale: "en",
      heading: "No preheader here",
      blocks: [{ kind: "text", content: "Body text only." }],
    };
    const result = renderEmailShell(noPreheader);
    // Verify the heading is present but no extra preheader div text
    expect(result.html).toContain("No preheader here");
    // The preheader sentinel span (used for email client inbox preview) should be absent
    expect(result.html).not.toContain("preview-text");
  });
});

// ---------------------------------------------------------------------------
// 8. Block kinds
// ---------------------------------------------------------------------------

describe("renderEmailShell — block kind rendering", () => {
  it("renders a button block in html", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).toContain("Accept invitation");
    expect(result.html).toContain("https://ampl.tools/palaeography/invite/abc");
  });

  it("renders a details block in html (label/value rows)", () => {
    const result = renderEmailShell(DETAILS_INPUT);
    expect(result.html).toContain("Date");
    expect(result.html).toContain("June 15, 2026");
    expect(result.html).toContain("Location");
    expect(result.html).toContain("Meeting Room A");
  });

  it("renders a details block in text (label/value rows)", () => {
    const result = renderEmailShell(DETAILS_INPUT);
    expect(result.text).toContain("Date");
    expect(result.text).toContain("June 15, 2026");
  });

  it("renders a note block in html", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).toContain("This invitation expires in 14 days.");
  });
});

// ---------------------------------------------------------------------------
// 9. Locale
// ---------------------------------------------------------------------------

describe("renderEmailShell — locale support", () => {
  it("renders an 'en' input without error and returns non-empty html+text", () => {
    const result = renderEmailShell(BASE_EN);
    expect(result.html).toBeTruthy();
    expect(result.text).toBeTruthy();
  });

  it("renders an 'es' input without error and returns non-empty html+text", () => {
    const result = renderEmailShell(BASE_ES);
    expect(result.html).toBeTruthy();
    expect(result.text).toBeTruthy();
  });

  it("'es' result contains the Spanish heading", () => {
    const result = renderEmailShell(BASE_ES);
    expect(result.html).toContain("Estás invitado a Calamus");
  });
});

// ---------------------------------------------------------------------------
// 10. HTML injection prevention
// ---------------------------------------------------------------------------

describe("renderEmailShell — HTML injection prevention", () => {
  it("heading containing HTML markup is escaped — no raw <a injected", () => {
    const malicious: EmailShellInput = {
      locale: "en",
      heading: '</td></tr></table><a href="https://evil.example">click</a>',
      blocks: [{ kind: "text", content: "Safe content." }],
    };
    const { html } = renderEmailShell(malicious);
    // The raw injected anchor must not appear
    expect(html).not.toContain("<a href=");
    // The angle brackets are escaped
    expect(html).toContain("&lt;/td&gt;");
  });

  it("text/note content containing HTML is escaped — no raw tags emitted", () => {
    const malicious: EmailShellInput = {
      locale: "en",
      heading: "Hello",
      blocks: [
        {
          kind: "text",
          content: '</td></tr></table><a href="https://evil.example">click</a>',
        },
        {
          kind: "note",
          content: '<script>alert(1)</script>',
        },
      ],
    };
    const { html } = renderEmailShell(malicious);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<a href=");
    expect(html).toContain("&lt;script&gt;");
  });

  it("button url with a quote cannot break out of the href attribute", () => {
    const malicious: EmailShellInput = {
      locale: "en",
      heading: "Action required",
      blocks: [
        {
          kind: "button",
          label: "Click here",
          url: 'https://x.example"><script>alert(1)</script>',
        },
      ],
    };
    const { html } = renderEmailShell(malicious);
    // The raw unescaped quote + script must not appear
    expect(html).not.toContain('"><script>');
    // The quote is escaped as &quot;
    expect(html).toContain("&quot;");
  });

  it("button url with javascript: scheme is neutralized to empty", () => {
    const malicious: EmailShellInput = {
      locale: "en",
      heading: "Action required",
      blocks: [
        {
          kind: "button",
          label: "Do not click",
          url: "javascript:alert(document.cookie)",
        },
      ],
    };
    const { html } = renderEmailShell(malicious);
    expect(html).not.toContain("javascript:");
    // The href attribute is present but empty
    expect(html).toContain('href=""');
  });

  it("details row label and value are HTML-escaped", () => {
    const malicious: EmailShellInput = {
      locale: "en",
      heading: "Details",
      blocks: [
        {
          kind: "details",
          rows: [
            {
              label: '<b onclick="evil()">Date</b>',
              value: '<a href="https://evil.example">June 15</a>',
            },
          ],
        },
      ],
    };
    const { html } = renderEmailShell(malicious);
    expect(html).not.toContain("<b ");
    expect(html).not.toContain("<a href=");
    expect(html).toContain("&lt;b");
    expect(html).toContain("&lt;a");
  });
});

// ---------------------------------------------------------------------------
// 11. Plain-text layout
// ---------------------------------------------------------------------------

describe("renderEmailShell — plain-text layout", () => {
  it("text output has exactly one blank line between heading and first block", () => {
    const input: EmailShellInput = {
      locale: "en",
      heading: "Hello",
      blocks: [{ kind: "text", content: "Body." }],
    };
    const { text } = renderEmailShell(input);
    // heading + \n (join "\n") + "" + \n (join "\n") + blockLines
    // should be "Hello\n\nBody.\n"
    expect(text).toBe("Hello\n\nBody.\n");
  });

  it("text output has exactly one blank line between consecutive blocks", () => {
    const input: EmailShellInput = {
      locale: "en",
      heading: "Hello",
      blocks: [
        { kind: "text", content: "First." },
        { kind: "text", content: "Second." },
      ],
    };
    const { text } = renderEmailShell(input);
    // "Hello\n\nFirst.\n\nSecond.\n"
    // No triple blank lines (the old double-\n join bug)
    expect(text).toBe("Hello\n\nFirst.\n\nSecond.\n");
    expect(text).not.toContain("\n\n\n");
  });

  it("preheader is NOT included in the text output", () => {
    const input: EmailShellInput = {
      locale: "en",
      preheader: "Inbox preview text here",
      heading: "Hello",
      blocks: [{ kind: "text", content: "Body." }],
    };
    const { text } = renderEmailShell(input);
    expect(text).not.toContain("Inbox preview text here");
  });
});
