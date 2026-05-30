/**
 * Root layout header tests (SSR)
 *
 * These cover the header wiring in `app/root.tsx`, which renders the shared
 * `AmplHeader` (full masthead, signed-out front door). Because `Layout` uses
 * `useRouteLoaderData` (needs a data-router context), the test renders
 * `AmplHeader` directly with the same props root.tsx passes, using
 * `renderToString`. No i18n provider in the Workers pool → `t()` returns keys,
 * so assertions target hrefs and structural markers, not translated copy.
 *
 * @version v0.3.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

async function renderHeader() {
  const { AmplHeader, LocaleSwitcher } = await import("@ampl/kit/ui");
  const switcher = React.createElement(LocaleSwitcher, {
    buildHref: (lng: "en" | "es") => `/auth/locale?lng=${lng}&to=%2F`,
    current: "en" as "en" | "es",
    variant: "on-dark" as const,
  });
  return renderToString(
    React.createElement(AmplHeader, {
      tool: "auth",
      toolName: "Account",
      size: "full",
      localeSwitcher: switcher,
    }),
  );
}

describe("root layout header", () => {
  it("renders the AMPL logo lockup linking to the lab home", async () => {
    const html = await renderHeader();
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/"');
    expect(html).toContain("<img");
    expect(html).toMatch(/src="[^"]+"/);
  });

  it("renders all four lab-site nav links", async () => {
    const html = await renderHeader();
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/#tools"');
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/#projects"');
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/#opportunities"');
    expect(html).toContain('href="https://ampl.clair.ucsb.edu/people"');
  });

  it("renders the WORKSHOP band with the tool name and locale switcher", async () => {
    const html = await renderHeader();
    expect(html).toContain("bg-accent-deep");
    expect(html).toContain("Account"); // toolName
    expect(html).toContain("/auth/locale"); // locale switcher wired
  });

  it("does NOT contain the old 'AMPL Auth' text lockup", async () => {
    const html = await renderHeader();
    expect(html).not.toContain(">AMPL Auth<");
  });

  it("uses the full masthead logo size (220px)", async () => {
    const html = await renderHeader();
    expect(html).toContain("w-[220px]");
  });
});
