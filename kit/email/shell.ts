/**
 * renderEmailShell — generic bilingual branded email shell
 *
 * Maps `EmailShellInput` (a structured `EmailBlock[]`) to a cross-client
 * HTML fragment plus a plain-text counterpart. Both bodies are derived from
 * the same structured input in one call so they cannot drift out of sync.
 *
 * Invariants:
 *   - The shell renders branded CONTENT only. It never emits the compliance
 *     footer or an unsubscribe link. The Worker's `deliver()` function
 *     stamps the footer after this fragment.
 *   - The output is an HTML FRAGMENT — no DOCTYPE, no `<html>`, no `<head>`,
 *     no `</html>`. The Worker concatenates this fragment
 *     with `"\n" + footer.html`.
 *   - The `EmailBlock` union is closed; no raw-HTML escape hatch. Every
 *     consumer-supplied string is HTML-escaped before interpolation — the closed
 *     union prevents kind-level injection, and escaping prevents value-level
 *     injection inside those blocks.
 *   - `DEFAULT_AMPL_LOGO_URL` is the only host coupling in kit. Consumers and
 *     tests may override it via `input.logoUrl`. The actual upload of the logo
 *     asset to this URL is a deployment follow-up documented in CONSUMING.md.
 *
 * @version v0.2.0
 */

import type { EmailShellInput, EmailBlock } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// HTML escaping — applied to every consumer-supplied string before interpolation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape a string for safe interpolation into an HTML context.
 *
 * Covers the full set of characters that are significant in both element-content
 * and attribute-value contexts (`&`, `<`, `>`, `"`, `'`). Applied to every
 * consumer-supplied value before it is written into the HTML output — headings,
 * preheaders, block content, button labels, button URLs, details rows, and the
 * logo src — so that no consumer input, however it was derived, can inject
 * markup, attributes, or script into the delivered email.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validate and return a safe URL for use in an `href` or `src` attribute.
 *
 * Accepts `https:` and `mailto:` schemes only. Any other scheme (including
 * `javascript:`, `data:`, `vbscript:`, etc.) is replaced with an empty string
 * so the generated attribute is inert rather than exploitable. The validated
 * value is then HTML-escaped for attribute context.
 */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https:/i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Logo constant — the only host coupling in kit (overridable via input.logoUrl)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default hosted HTTPS URL for the AMPL logo image.
 *
 * This is the only host-specific constant in kit. Consumers and tests may
 * supply a different URL via `EmailShellInput.logoUrl`; when that field is
 * omitted the shell falls back to this constant. The actual PNG asset must
 * be uploaded to this URL as a deployment follow-up (not gating this surface).
 *
 * Using a hosted URL (not data-URI, inline SVG, or CID attachment) is
 * required for cross-client rendering: Gmail blocks CID and strips inline
 * SVG; Outlook requires an HTTP/S src for `<img>`.
 */
export const DEFAULT_AMPL_LOGO_URL =
  "https://ampl.clair.ucsb.edu/assets/ampl-logo.png";

// ─────────────────────────────────────────────────────────────────────────────
// Block renderers — HTML
// ─────────────────────────────────────────────────────────────────────────────

function renderBlockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
      return [
        `<tr>`,
        `  <td style="padding:8px 0;font-size:16px;line-height:1.5;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
        `    ${escapeHtml(block.content)}`,
        `  </td>`,
        `</tr>`,
      ].join("\n");

    case "button": {
      const safeHref = safeUrl(block.url);
      const safeLabel = escapeHtml(block.label);
      return [
        `<tr>`,
        `  <td align="center" style="padding:16px 0;">`,
        `    <!--[if mso]>`,
        `    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"`,
        `                 xmlns:w="urn:schemas-microsoft-com:office:word"`,
        `                 href="${safeHref}"`,
        `                 style="height:44px;v-text-anchor:middle;width:200px;"`,
        `                 arcsize="8%"`,
        `                 stroke="f"`,
        `                 fillcolor="#A5469A">`,
        `      <w:anchorlock/>`,
        `      <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">`,
        `        ${safeLabel}`,
        `      </center>`,
        `    </v:roundrect>`,
        `    <![endif]-->`,
        `    <a href="${safeHref}"`,
        `       style="background-color:#A5469A;border-radius:4px;color:#ffffff;display:inline-block;font-family:sans-serif;font-size:15px;font-weight:bold;line-height:44px;text-align:center;text-decoration:none;width:200px;mso-hide:all;-webkit-text-size-adjust:none;">`,
        `      ${safeLabel}`,
        `    </a>`,
        `  </td>`,
        `</tr>`,
      ].join("\n");
    }

    case "details": {
      const rows = block.rows
        .map(
          (row) =>
            [
              `      <tr>`,
              `        <td style="color:#6b7280;padding:4px 8px 4px 0;white-space:nowrap;font-weight:600;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;">${escapeHtml(row.label)}</td>`,
              `        <td style="color:#111827;padding:4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;">${escapeHtml(row.value)}</td>`,
              `      </tr>`,
            ].join("\n"),
        )
        .join("\n");
      return [
        `<tr>`,
        `  <td style="padding:12px 0;">`,
        `    <table width="100%" cellpadding="4" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px;">`,
        rows,
        `    </table>`,
        `  </td>`,
        `</tr>`,
      ].join("\n");
    }

    case "note":
      return [
        `<tr>`,
        `  <td style="padding:4px 0;font-size:13px;color:#6b7280;font-style:italic;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
        `    ${escapeHtml(block.content)}`,
        `  </td>`,
        `</tr>`,
      ].join("\n");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Block renderers — plain text
// ─────────────────────────────────────────────────────────────────────────────

function renderBlockText(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
      return `${block.content}\n`;

    case "button":
      return `${block.label}: ${block.url}\n`;

    case "details":
      return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n") + "\n";

    case "note":
      return `(${block.content})\n`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// renderEmailShell — the only public export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a bilingual branded email shell from structured `EmailBlock[]`.
 *
 * Returns both `html` (a table-based inline-styled HTML fragment) and `text`
 * (a readable plain-text equivalent) derived from the same input in one call
 * so they cannot drift out of sync.
 *
 * The `html` output is a FRAGMENT — it starts with a `<table>` and ends
 * with `</table>`. It contains no DOCTYPE, no `<html>`, no `<head>`, and no
 * `</html>`. The Worker's `deliver()` appends the compliance footer after this
 * fragment.
 *
 * @param input - Shell input including locale, optional preheader, heading,
 *                content blocks, and an optional logo URL override.
 * @returns `{ html: string, text: string }` — both bodies from one call.
 */
export function renderEmailShell(input: EmailShellInput): {
  html: string;
  text: string;
} {
  const { locale, preheader, heading, blocks, logoUrl } = input;
  const resolvedLogoUrl = logoUrl ?? DEFAULT_AMPL_LOGO_URL;

  // ── HTML fragment ──────────────────────────────────────────────────────────

  // Preheader is a hidden div; emitted only when `input.preheader` is set.
  const preheaderHtml = preheader
    ? `<div style="display:none;font-size:1px;max-height:0px;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>\n`
    : "";

  const blockRows = blocks.map(renderBlockHtml).join("\n");

  const html = [
    // Outer full-width background table — the fragment root
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" lang="${locale}" style="background-color:#f9fafb;">`,
    `<tr>`,
    `  <td align="center" style="padding:24px 16px;">`,
    preheaderHtml,
    // Inner content table — centered, max 600px wide
    `    <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;">`,
    // Header row — AMPL logo
    `      <tr>`,
    `        <td align="center" style="padding:24px 24px 16px 24px;background-color:#ffffff;">`,
    `          <img src="${safeUrl(resolvedLogoUrl)}" alt="AMPL" width="120" style="display:block;border:0;outline:none;text-decoration:none;">`,
    `        </td>`,
    `      </tr>`,
    // Heading row
    `      <tr>`,
    `        <td style="padding:0 24px 16px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">`,
    `        ${escapeHtml(heading)}`,
    `        </td>`,
    `      </tr>`,
    // Content blocks
    `      <tr>`,
    `        <td style="padding:0 24px 24px 24px;">`,
    `          <table width="100%" cellpadding="0" cellspacing="0" border="0">`,
    blockRows,
    `          </table>`,
    `        </td>`,
    `      </tr>`,
    // End content table — no trailing bottom border/margin (the footer adds its own border-top)
    `    </table>`,
    `  </td>`,
    `</tr>`,
    `</table>`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  // ── Plain-text counterpart ─────────────────────────────────────────────────
  //
  // Each `renderBlockText` call returns a string that ends with exactly one `\n`.
  // We join with `\n` between blocks so each block is separated by one blank line
  // (the trailing `\n` from the preceding block + the joining `\n` = one blank
  // line). `preheader` is omitted from the text path — it is inbox-preview text
  // only, meaningful in HTML clients but not in plain-text readers.

  const blockLines = blocks.map(renderBlockText).join("\n");

  const text = [heading, "", blockLines].join("\n");

  return { html, text };
}
