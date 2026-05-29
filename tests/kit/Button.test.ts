/**
 * Button rendering tests
 *
 * These tests cover `kit/ui/Button` — the shared button primitive with fill,
 * text, and dark variants. They render to a string on the server and check:
 *
 *   B1  Dark variant: a Button with variant="dark" renders markup containing the
 *       GitHub-dark background utility `bg-[#24292e]` and white text `text-white`,
 *       and the button content is present in the output.
 *   B2  Fill unchanged: a Button with no variant prop (default) still renders
 *       the filled pill class `bg-accent` and not `bg-[#24292e]`.
 *   B3  Text unchanged: a Button with variant="text" still renders the borderless
 *       text style (no `bg-accent`, no `bg-[#24292e]`).
 *
 * The tests use `renderToString` — no jsdom or testing-library needed.
 *
 * @version v0.2.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("Button", () => {
  it("B1: dark variant renders GitHub-dark background and white text with button content", async () => {
    const { Button } = await import("kit/ui/Button");

    const html = renderToString(
      React.createElement(Button, { variant: "dark", children: "Sign in with GitHub" }),
    );

    expect(html).toContain("bg-[#24292e]");
    expect(html).toContain("text-white");
    expect(html).toContain("Sign in with GitHub");
  });

  it("B2: default (fill) variant renders bg-accent and not the dark background", async () => {
    const { Button } = await import("kit/ui/Button");

    const html = renderToString(
      React.createElement(Button, { children: "Click me" }),
    );

    expect(html).toContain("bg-accent");
    expect(html).not.toContain("bg-[#24292e]");
    expect(html).toContain("Click me");
  });

  it("B3: text variant renders without bg-accent or the dark background", async () => {
    const { Button } = await import("kit/ui/Button");

    const html = renderToString(
      React.createElement(Button, { variant: "text", children: "Sign out" }),
    );

    expect(html).not.toContain("bg-accent");
    expect(html).not.toContain("bg-[#24292e]");
    expect(html).toContain("Sign out");
  });
});
