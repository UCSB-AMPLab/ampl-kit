/**
 * NoAccess rendering tests
 *
 * These tests cover `kit/ui/NoAccess` — the dead-end "you don't have access"
 * page that consuming tools render for unauthorised authenticated users. They
 * render to a string on the server and check the resulting HTML structure.
 *
 * Because the Workers test pool has no i18n provider wired in, translated text
 * falls back to its key name — so these assertions stick to structural HTML,
 * not copy. The tests use `renderToString` rather than a browser DOM, so no
 * jsdom or testing-library dependency is needed.
 *
 * Test cases:
 *   With returnHref supplied: output contains an `<a`, the href value, and the
 *   `bg-accent` fill-pill class — the CTA is rendered via the Button primitive,
 *   not a hand-rolled anchor.
 *   Without returnHref: no `<a` element renders (CTA is hidden).
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("NoAccess", () => {
  it("with returnHref, renders an <a with the href and bg-accent fill-pill class", async () => {
    const { NoAccess } = await import("kit/ui/NoAccess");

    const html = renderToString(
      React.createElement(NoAccess, {
        toolName: "Calamus",
        returnHref: "/palaeography",
      }),
    );

    expect(html).toContain("<a");
    expect(html).toContain('href="/palaeography"');
    expect(html).toContain("bg-accent");
  });

  it("without returnHref, no <a element renders", async () => {
    const { NoAccess } = await import("kit/ui/NoAccess");

    const html = renderToString(
      React.createElement(NoAccess, {
        toolName: "Calamus",
      }),
    );

    expect(html).not.toContain("<a");
  });
});
