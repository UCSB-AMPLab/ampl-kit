/**
 * AccountWidget rendering tests
 *
 * These tests cover `kit/ui/AccountWidget` — the small signed-in widget that
 * shows a user's avatar and a sign-out link. They render it to a string on the
 * server and check the resulting HTML: that a real avatar URL becomes an
 * `<img>` with that exact `src`, that the sign-out link points at the href it
 * was given, and that a missing avatar produces a placeholder rather than a
 * broken image. They render with `renderToString` and `StaticRouter` rather
 * than a browser DOM, so no `jsdom` or testing-library dependency is needed.
 * Because the Workers test pool has no i18n provider wired in, translated text
 * falls back to its key name — so these assertions stick to structural HTML,
 * not copy.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

const AVATAR_URL = "https://avatars.githubusercontent.com/u/1?v=4";

describe("AccountWidget", () => {
  it("AW1: renders the passed avatarUrl as an img src", async () => {
    const { AccountWidget } = await import("kit/ui/AccountWidget");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(AccountWidget, {
          name: "Ada",
          handle: "ada",
          avatarUrl: AVATAR_URL,
          signOutHref: "/auth/logout",
        }),
      ),
    );

    expect(html).toContain(`src="${AVATAR_URL}"`);
  });

  it("AW2: renders the sign-out link with the passed signOutHref", async () => {
    const { AccountWidget } = await import("kit/ui/AccountWidget");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(AccountWidget, {
          name: "Ada",
          handle: "ada",
          avatarUrl: AVATAR_URL,
          signOutHref: "/auth/logout",
        }),
      ),
    );

    expect(html).toContain('href="/auth/logout"');
  });

  it("AW3: renders no <img when avatarUrl is null (placeholder div instead)", async () => {
    const { AccountWidget } = await import("kit/ui/AccountWidget");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(AccountWidget, {
          name: "Ada",
          handle: "ada",
          avatarUrl: null,
          signOutHref: "/auth/logout",
        }),
      ),
    );

    // With avatarUrl=null, AccountWidget renders a <div> placeholder, not <img>
    expect(html).not.toContain("<img");
  });
});
