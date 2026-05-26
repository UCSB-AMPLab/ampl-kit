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
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

describe("auth.login page", () => {
  it("L1: renders GitHub link and button text (or i18n key fallback)", async () => {
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

  it("L2: ?error=state-mismatch renders an error alert element", async () => {
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

  it("L3: ?error=rate-limited renders an error alert element", async () => {
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
});
