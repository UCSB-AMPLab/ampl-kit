/**
 * SiteHeader rendering tests
 *
 * These tests cover `kit/ui/SiteHeader` — the shared header frame that exposes a
 * lockup slot (children), a locale-switcher slot, and an optional nav slot. They
 * render to a string on the server and check:
 *
 *   SH1  Backward compat — without a nav prop, the right column renders the
 *        localeSwitcher directly with no extra flex-col wrapper.
 *   SH2  Nav present — with a nav node supplied, SSR output contains both the nav
 *        sentinel and the switcher sentinel, nav appearing before the switcher in
 *        document order.
 *   SH3  Children unaffected — the lockup node renders in the left column in
 *        both the no-nav and nav-present cases.
 *
 * The tests use `renderToString` with no i18n provider — SiteHeader itself uses
 * no translation hooks, so the output is deterministic.
 *
 * @version v0.2.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("SiteHeader", () => {
  it("SH1: without nav prop, right column renders localeSwitcher directly (no extra flex-col wrapper)", async () => {
    const { SiteHeader } = await import("kit/ui/SiteHeader");

    const html = renderToString(
      React.createElement(
        SiteHeader,
        {
          localeSwitcher: React.createElement(
            "span",
            { "data-testid": "switcher-sentinel" },
            "SWITCHER",
          ),
        },
        React.createElement("span", { "data-testid": "lockup-sentinel" }, "LOCKUP"),
      ),
    );

    // The switcher sentinel must be present
    expect(html).toContain("switcher-sentinel");
    // No extra stacking wrapper (flex-col items-end gap-2) when nav is absent
    expect(html).not.toContain("flex-col items-end gap-2");
  });

  it("SH2: with nav prop, SSR output contains both the nav node and the localeSwitcher node, nav appearing before the switcher", async () => {
    const { SiteHeader } = await import("kit/ui/SiteHeader");

    const html = renderToString(
      React.createElement(
        SiteHeader,
        {
          localeSwitcher: React.createElement(
            "span",
            { "data-testid": "switcher-sentinel" },
            "SWITCHER",
          ),
          nav: React.createElement(
            "nav",
            { "data-testid": "nav-sentinel" },
            "NAV",
          ),
        },
        React.createElement("span", { "data-testid": "lockup-sentinel" }, "LOCKUP"),
      ),
    );

    // Both sentinels must be present
    expect(html).toContain("nav-sentinel");
    expect(html).toContain("switcher-sentinel");

    // Nav appears before the switcher in document order
    const navPos = html.indexOf("nav-sentinel");
    const switcherPos = html.indexOf("switcher-sentinel");
    expect(navPos).toBeLessThan(switcherPos);
  });

  it("SH3: children (lockup) renders in both the no-nav and nav-present cases", async () => {
    const { SiteHeader } = await import("kit/ui/SiteHeader");

    // No nav
    const htmlNoNav = renderToString(
      React.createElement(
        SiteHeader,
        {
          localeSwitcher: React.createElement("span", null, "SWITCHER"),
        },
        React.createElement("span", { "data-testid": "lockup-no-nav" }, "LOCKUP"),
      ),
    );
    expect(htmlNoNav).toContain("lockup-no-nav");

    // With nav
    const htmlWithNav = renderToString(
      React.createElement(
        SiteHeader,
        {
          localeSwitcher: React.createElement("span", null, "SWITCHER"),
          nav: React.createElement("nav", null, "NAV"),
        },
        React.createElement("span", { "data-testid": "lockup-with-nav" }, "LOCKUP"),
      ),
    );
    expect(htmlWithNav).toContain("lockup-with-nav");
  });
});
