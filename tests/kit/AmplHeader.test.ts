/**
 * AmplHeader rendering tests
 *
 * Server-rendered (renderToString, no jsdom, no i18n provider → t() returns the
 * key). Assertions stick to structure/HTML: hrefs, classes, aria-current, the
 * account-vs-sign-in branch, switcher registry, and the size variant. Tool names
 * and nav labels are literal props/registry values, so they assert directly.
 */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

async function render(props: Record<string, unknown>) {
  const { AmplHeader } = await import("kit/ui/ampl-header/AmplHeader");
  return renderToString(React.createElement(AmplHeader, props as never));
}

const SWITCHER = React.createElement("span", { "data-testid": "ls" }, "EN/ES");

describe("AmplHeader", () => {
  it("signed-in: renders the account menu (POST sign-out form), no sign-in link", async () => {
    const html = await render({
      tool: "calamus", toolName: "Palaeography", localeSwitcher: SWITCHER,
      account: { name: "Juan Cobo", handle: "juan", avatarUrl: null, signOutHref: "/auth/logout", returnTo: "/palaeography" },
    });
    expect(html).toContain("Palaeography");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/auth/logout?return_to=%2Fpalaeography"');
    expect(html).not.toContain("header.signIn"); // no sign-in link rendered
  });

  it("public/signed-out: renders the sign-in link, no account form", async () => {
    const html = await render({
      tool: "scheduling", toolName: "Scheduling", localeSwitcher: SWITCHER,
      account: null, signInHref: "/auth/login",
    });
    expect(html).toContain('href="/auth/login"');
    expect(html).not.toContain('method="post"');
  });

  it("sign-in label is overridable", async () => {
    const html = await render({
      tool: "scheduling", toolName: "Scheduling", localeSwitcher: SWITCHER,
      account: null, signInHref: "/auth/login", signInLabel: "Host sign in",
    });
    expect(html).toContain("Host sign in");
  });

  it("switcher lists the default registry and marks the current tool", async () => {
    const html = await render({ tool: "calamus", toolName: "Palaeography", localeSwitcher: SWITCHER, account: null });
    expect(html).toContain("Palaeography");
    expect(html).toContain("Scheduling");
    expect(html).toContain('aria-current="true"');
  });

  it("active nav item gets the white underline (after: + text-white)", async () => {
    const html = await render({
      tool: "calamus", toolName: "Palaeography", localeSwitcher: SWITCHER, account: null,
      nav: [
        { label: "Dashboard", href: "/d", active: false },
        { label: "Library", href: "/l", active: true },
        { label: "Review queue", href: "/r", disabled: true },
      ],
    });
    expect(html).toContain('href="/l"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("after:bg-white");
    expect(html).toContain('aria-disabled="true"');
  });

  it("full size uses the 220px logo; compact uses 132px", async () => {
    const full = await render({ tool: "calamus", toolName: "Palaeography", localeSwitcher: SWITCHER, account: null, size: "full" });
    expect(full).toContain("w-[220px]");
    const compact = await render({ tool: "calamus", toolName: "Palaeography", localeSwitcher: SWITCHER, account: null });
    expect(compact).toContain("w-[132px]");
  });

  it("renders the deep-plum WORKSHOP band and the mobile sheet (hidden at rest)", async () => {
    const html = await render({ tool: "calamus", toolName: "Palaeography", localeSwitcher: SWITCHER, account: null });
    expect(html).toContain("bg-accent-deep");
    // The mobile sheet is always in the DOM but hidden until the hamburger
    // toggles it; SSR (menuOpen=false) must emit the `hidden` attribute.
    expect(html).toMatch(/id="ampl-mobile-sheet"[^>]*\shidden/);
  });

  it("account takes precedence over signInHref (no sign-in link when signed in)", async () => {
    const html = await render({
      tool: "calamus", toolName: "Palaeography", localeSwitcher: SWITCHER,
      account: { name: "Juan Cobo", handle: "juan", avatarUrl: null },
      signInHref: "/auth/login",
    });
    expect(html).toContain('method="post"'); // account menu present
    expect(html).not.toContain('href="/auth/login"'); // sign-in link suppressed
  });
});
