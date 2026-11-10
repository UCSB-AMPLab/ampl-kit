/**
 * Login page tests
 *
 * These tests cover `app/routes/auth.login.tsx` — the page that offers the
 * "Continue with GitHub" link and surfaces any sign-in error. They render the
 * page on the server and check that it always links to `/auth/github` to start
 * the OAuth flow, that no error alert shows when the URL carries no error, and
 * that an `?error=` value (such as a state mismatch or a rate-limit) makes the
 * page render an alert with `role="alert"` so the user is told what went wrong.
 * The Workers test pool has no i18n provider, so translated copy falls back to
 * its key name — the assertions match either the key or its translation and
 * lean on structural HTML rather than the exact wording.
 *
 * The final two cases cover the sign-in button restyle: it must use the kit
 * `dark` variant (bg-[#24292e]) and contain an inline Octocat SVG.
 *
 * @version v0.2.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("auth.login page", () => {
  it("renders GitHub link and button text (or i18n key fallback)", async () => {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/login" },
        React.createElement(LoginPage as React.ComponentType),
      ),
    );

    // The page renders the GitHub link with href=/auth/github
    expect(html).toContain('href="/auth/github"');

    // The "Continue with GitHub" i18n key or its translated value appears
    // (in tests without an i18n provider, t() returns the key name)
    expect(html).toMatch(/continueWithGithub|Continue with GitHub/i);

    // No error alert shown when no ?error= is present
    expect(html).not.toContain('role="alert"');
  });

  it("?error=state-mismatch renders an error alert element", async () => {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/login?error=state-mismatch" },
        React.createElement(LoginPage as React.ComponentType),
      ),
    );

    // An error alert element must appear when ?error= is present
    expect(html).toContain('role="alert"');
    // The GitHub link is still rendered
    expect(html).toContain('href="/auth/github"');
  });

  it("?error=rate-limited renders an error alert element", async () => {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/login?error=rate-limited" },
        React.createElement(LoginPage as React.ComponentType),
      ),
    );

    // An error alert element must appear when ?error= is present
    expect(html).toContain('role="alert"');
    // The GitHub link is still rendered
    expect(html).toContain('href="/auth/github"');
  });

  it("forwards return_to to the GitHub button href (encoded)", async () => {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");

    const returnTo = "/palaeography/invite/accept?token=abc";
    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: `/auth/login?return_to=${encodeURIComponent(returnTo)}` },
        React.createElement(LoginPage as React.ComponentType),
      ),
    );

    // The GitHub start link must carry the return_to, percent-encoded, so the
    // deep-link destination survives the OAuth round-trip.
    expect(html).toContain(
      `href="/auth/github?return_to=${encodeURIComponent(returnTo)}"`,
    );
  });

  it("parity: no return_to → GitHub button href stays plain /auth/github", async () => {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/login" },
        React.createElement(LoginPage as React.ComponentType),
      ),
    );

    // Without a return_to, the href carries no query string.
    expect(html).toContain('href="/auth/github"');
    expect(html).not.toContain("return_to");
  });

  it("sign-in button uses the dark variant", async () => {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/login" },
        React.createElement(LoginPage as React.ComponentType),
      ),
    );

    // The dark variant renders with GitHub-dark background class bg-[#24292e]
    // (the class string added to Button in 05-01 for the dark variant)
    expect(html).toContain("bg-[#24292e]");
  });

  it("sign-in button contains an inline Octocat SVG", async () => {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/login" },
        React.createElement(LoginPage as React.ComponentType),
      ),
    );

    // An inline SVG element with a viewBox is rendered inside the button —
    // this is the Octocat mark, added inline with no new runtime dependency
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 98 96"');
    // The link still goes to /auth/github (auth flow unchanged)
    expect(html).toContain('href="/auth/github"');
  });
});

describe("auth.login page — email sign-in form", () => {
  const loaderData = {
    emailEnabled: true,
    domains: ["ucsb.edu"],
    turnstileSiteKey: "1x00000000000000000000AA",
    turnstileAction: "email-login",
    nonce: "test-nonce",
  };

  async function render(location: string, data: unknown) {
    const { default: LoginPage } = await import("~/routes/auth.login");
    const { StaticRouter } = await import("react-router");
    return renderToString(
      React.createElement(
        StaticRouter,
        { location },
        React.createElement(LoginPage as React.ComponentType<any>, { loaderData: data }),
      ),
    );
  }

  it("renders the email form above the GitHub button, with an 'or' divider", async () => {
    const html = await render("/auth/login?return_to=%2Fpaleography", loaderData);
    expect(html).toContain('action="/auth/email/request"');
    expect(html).toContain('method="post"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="return_to"');
    expect(html).toContain('value="/paleography"');
    expect(html).toContain('data-sitekey="1x00000000000000000000AA"');
    expect(html).toContain('data-action="email-login"');
    expect(html).toMatch(/nonce="test-nonce"/);
    expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    const form = html.indexOf('action="/auth/email/request"');
    const divider = html.search(/login\.or|>or</);
    const github = html.indexOf("/auth/github");
    expect(form).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(form);
    expect(github).toBeGreaterThan(divider);
  });

  it("hides the email form and the Turnstile script when email sign-in is off", async () => {
    const html = await render("/auth/login", { ...loaderData, emailEnabled: false });
    expect(html).not.toContain("/auth/email/request");
    expect(html).not.toContain("challenges.cloudflare.com");
    expect(html).toContain('href="/auth/github"');
  });

  it("?error=email-domain renders an alert", async () => {
    const html = await render("/auth/login?error=email-domain", loaderData);
    expect(html).toContain('role="alert"');
  });
});
