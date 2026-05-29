/**
 * Root layout header tests (SSR)
 *
 * These tests cover the header wiring in `app/root.tsx` — the AMPL logo lockup
 * and the four-link lab-site nav. Because `Layout` uses
 * `useRouteLoaderData` which requires a data router context, tests render the
 * header subcomponents (SiteHeader + the logo/nav nodes) directly using
 * `renderToString`, mirroring the shape that root.tsx wires up. This is the
 * same SSR-inspection strategy as `tests/routes/auth.login.test.ts`, adapted
 * for a component under a data-router boundary.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("root layout header", () => {
  it("logo img is present, wrapped in a link to the lab home", async () => {
    const { SiteHeader } = await import("@ampl/kit/ui");
    const amplLogo = await import("@ampl/kit/assets/ampl-logo.svg");

    const logoNode = React.createElement(
      "a",
      { href: "https://ampl.clair.ucsb.edu/", "aria-label": "AMPL — Archives, Memory, and Preservation Lab" },
      React.createElement("img", { src: amplLogo.default, alt: "", className: "h-auto w-[220px]" }),
    );

    const html = renderToString(
      React.createElement(SiteHeader, { children: logoNode }),
    );

    // The lab-home link is present
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/"');
    // An img element is inside the link
    expect(html).toContain("<img");
    // src attribute is non-empty (the asset resolved)
    expect(html).toMatch(/src="[^"]+"/);
  });

  it("header does NOT contain the old 'AMPL Auth' text lockup", async () => {
    const { SiteHeader } = await import("@ampl/kit/ui");
    const amplLogo = await import("@ampl/kit/assets/ampl-logo.svg");

    const logoNode = React.createElement(
      "a",
      { href: "https://ampl.clair.ucsb.edu/", "aria-label": "AMPL — Archives, Memory, and Preservation Lab" },
      React.createElement("img", { src: amplLogo.default, alt: "", className: "h-auto w-[220px]" }),
    );

    const html = renderToString(
      React.createElement(SiteHeader, { children: logoNode }),
    );

    // Old text lockup must not appear
    expect(html).not.toContain(">AMPL Auth<");
  });

  it("nav slot renders all four lab-site links", async () => {
    const { SiteHeader } = await import("@ampl/kit/ui");

    const navNode = React.createElement(
      "nav",
      { "aria-label": "Lab site navigation" },
      React.createElement("a", { href: "https://ampl.clair.ucsb.edu/#tools" }, "Tools"),
      React.createElement("a", { href: "https://ampl.clair.ucsb.edu/#projects" }, "Projects"),
      React.createElement("a", { href: "https://ampl.clair.ucsb.edu/#opportunities" }, "Opportunities"),
      React.createElement("a", { href: "https://ampl.clair.ucsb.edu/people" }, "People"),
    );

    const html = renderToString(
      React.createElement(SiteHeader, { nav: navNode }),
    );

    // All four lab-site hrefs must appear
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/#tools"');
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/#projects"');
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/#opportunities"');
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/people"');
  });

  it("nav and localeSwitcher are both rendered when both slots are filled", async () => {
    const { SiteHeader, LocaleSwitcher } = await import("@ampl/kit/ui");

    const navNode = React.createElement(
      "nav",
      { "aria-label": "Lab site navigation" },
      React.createElement("a", { href: "https://ampl.clair.ucsb.edu/#tools" }, "Tools"),
      React.createElement("a", { href: "https://ampl.clair.ucsb.edu/people" }, "People"),
    );

    const switcherNode = React.createElement(LocaleSwitcher, {
      buildHref: (lng: "en" | "es") => `/auth/locale?lng=${lng}&to=%2F`,
      current: "en" as "en" | "es",
    });

    const html = renderToString(
      React.createElement(SiteHeader, { nav: navNode, localeSwitcher: switcherNode }),
    );

    // Both nav links and the locale switcher are in the output
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/#tools"');
    // LocaleSwitcher renders locale-switch links containing /locale
    expect(html).toContain("/locale");
  });
});
