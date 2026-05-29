/**
 * AccountWidget rendering tests
 *
 * These tests cover `kit/ui/AccountWidget` — the small signed-in widget that
 * shows a user's avatar and a sign-out control. They render it to a string on
 * the server and check the resulting HTML: that a real avatar URL becomes an
 * `<img>` with that exact `src`, that sign-out is a POST `<form>` whose action
 * is the href it was given (driven by a submit `<button>`, never a GET `<a>`,
 * because every logout endpoint is action-only and a GET anchor can't drive a
 * POST), that an optional `returnTo` is appended to the action as a guarded
 * query param, and that a missing avatar produces a placeholder rather than a
 * broken image. They render with `renderToString` and `StaticRouter` rather
 * than a browser DOM, so no `jsdom` or testing-library dependency is needed.
 * Because the Workers test pool has no i18n provider wired in, translated text
 * falls back to its key name — so these assertions stick to structural HTML,
 * not copy.
 *
 * @version v0.1.1
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

const AVATAR_URL = "https://avatars.githubusercontent.com/u/1?v=4";

describe("AccountWidget", () => {
  it("renders the passed avatarUrl as an img src", async () => {
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

  it("renders sign-out as a POST form whose action is the passed signOutHref", async () => {
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

    expect(html).toContain('method="post"');
    expect(html).toContain('action="/auth/logout"');
  });

  it("drives sign-out with a submit button, never a GET <a> anchor", async () => {
    // Regression guard: a GET <a href> can't drive the POST-only /auth/logout
    // action (GET returns 405), so clicking it was a no-op. Sign-out must be a
    // submit button inside a POST form, with no anchor pointing at the href.
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

    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('href="/auth/logout"');
  });

  it("appends an optional returnTo to the form action as a guarded query param", async () => {
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
          returnTo: "/palaeography",
        }),
      ),
    );

    // URL-encoded so the logout route's searchParams.get("return_to") decodes
    // it back to "/palaeography".
    expect(html).toContain('action="/auth/logout?return_to=%2Fpalaeography"');
  });

  it("renders no <img when avatarUrl is null (placeholder div instead)", async () => {
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

  it("posts to /auth/logout by default when signOutHref is omitted", async () => {
    // signOutHref is optional and defaults to the root-relative literal
    // "/auth/logout". A consumer tool wired to the apex gets POST-to-apex-logout
    // with no href argument — no import of a helper required.
    const { AccountWidget } = await import("kit/ui/AccountWidget");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(AccountWidget, {
          name: "Ada",
          // signOutHref intentionally omitted — default should apply
          avatarUrl: AVATAR_URL,
        }),
      ),
    );

    expect(html).toContain('method="post"');
    expect(html).toContain('action="/auth/logout"');
    // Assert root-relative, NOT absolute URL — a browser form action does not
    // need an origin and an absolute URL would couple the widget to the apex.
    expect(html).not.toContain('action="https://');
  });

  it("omits the @handle span when handle is not passed", async () => {
    // handle is optional. When absent (or empty-string), the @handle
    // <span> must not render at all — no bare "@" in the output. The name row
    // still renders.
    const { AccountWidget } = await import("kit/ui/AccountWidget");
    const { StaticRouter } = await import("react-router");

    const html = renderToString(
      React.createElement(
        StaticRouter,
        { location: "/auth/" },
        React.createElement(AccountWidget, {
          name: "Ada Lovelace",
          // handle intentionally omitted
          avatarUrl: AVATAR_URL,
          signOutHref: "/auth/logout",
        }),
      ),
    );

    // Name row still present
    expect(html).toContain("Ada Lovelace");
    // Handle span absent entirely — no "@" character in the output at all
    expect(html).not.toContain("@ada");
    expect(html).not.toContain(">@<");
  });
});
