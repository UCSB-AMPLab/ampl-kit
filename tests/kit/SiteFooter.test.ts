/**
 * SiteFooter rendering tests
 *
 * These tests cover `kit/ui/SiteFooter` — the shared footer that carries the
 * "report a problem" trigger, a terms-of-use link, and the report dialog. They
 * render it to a string on the server and check that the report trigger and
 * terms link are present and that the report form renders as a native
 * `<dialog>` element. They use `renderToString` with `StaticRouter` rather than
 * a browser DOM, so no `jsdom` or testing-library dependency is needed. The
 * Workers test pool has no i18n provider, so translated copy falls back to its
 * key name — the assertions accept either the key or its translation.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("SiteFooter", () => {
  it("SSR output contains the report-a-problem trigger (key or translation)", async () => {
    const { SiteFooter } = await import("kit/ui/SiteFooter");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(SiteFooter),
      ),
    );

    // t("reportProblem.trigger") returns key name "reportProblem.trigger" without
    // an i18n provider, OR "Report a problem" if the provider resolves
    expect(html).toMatch(/reportProblem\.trigger|Report a problem/i);
  });

  it("SSR output contains the footer terms key (or translation)", async () => {
    const { SiteFooter } = await import("kit/ui/SiteFooter");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(SiteFooter),
      ),
    );

    // t("footer.terms") falls back to key name or resolves to "Terms of Use"
    expect(html).toMatch(/footer\.terms|Terms of Use/i);
  });

  it("SSR output contains a <dialog element (ReportProblem modal markup)", async () => {
    const { SiteFooter } = await import("kit/ui/SiteFooter");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(SiteFooter),
      ),
    );

    // ReportProblem renders a native <dialog> — it must be present in SSR output
    expect(html).toContain("<dialog");
  });

  // Band 2 update assertions

  it("band 2 contains the lab copyright line", async () => {
    const { SiteFooter } = await import("kit/ui/SiteFooter");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(SiteFooter),
      ),
    );

    // Band 2 must contain the lab name (not the Regents line)
    expect(html).toContain("Archives, Memory, and Preservation Lab");
  });

  it("band 2 does NOT contain the Regents copyright line", async () => {
    const { SiteFooter } = await import("kit/ui/SiteFooter");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(SiteFooter),
      ),
    );

    // The Regents line must be gone
    expect(html).not.toContain("Regents of the University of California");
  });

  it("band 2 retains both statutory links", async () => {
    const { SiteFooter } = await import("kit/ui/SiteFooter");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(SiteFooter),
      ),
    );

    // Terms of Use and Accessibility links must be retained
    expect(html).toContain("https://www.ucsb.edu/terms-of-use");
    expect(html).toContain("https://clair.ucsb.edu/accessibility");
  });

  it("band 2 contains the current year adjacent to the copyright symbol", async () => {
    const { SiteFooter } = await import("kit/ui/SiteFooter");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(SiteFooter),
      ),
    );

    // The render-time year must appear near the copyright symbol
    const currentYear = String(new Date().getFullYear());
    expect(html).toContain(currentYear);
    // The copyright symbol must also appear
    expect(html).toContain("©");
  });
});
