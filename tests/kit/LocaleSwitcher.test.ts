import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("LocaleSwitcher", () => {
  it("default variant uses light-surface classes", async () => {
    const { LocaleSwitcher } = await import("kit/ui/LocaleSwitcher");
    const html = renderToString(
      React.createElement(LocaleSwitcher, { buildHref: (l: "en" | "es") => `/l?lng=${l}`, current: "en" }),
    );
    expect(html).toContain("text-fg-1");
    expect(html).not.toContain("text-white");
  });

  it("on-dark variant uses white classes for the plum band", async () => {
    const { LocaleSwitcher } = await import("kit/ui/LocaleSwitcher");
    const html = renderToString(
      React.createElement(LocaleSwitcher, { buildHref: (l: "en" | "es") => `/l?lng=${l}`, current: "en", variant: "on-dark" }),
    );
    expect(html).toContain("text-white");
    expect(html).toContain("text-white/60"); // idle link stays readable on the plum band
    expect(html).toContain('aria-current="true"');
  });
});
