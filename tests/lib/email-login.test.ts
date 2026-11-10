/**
 * Email sign-in helper tests
 *
 * Unit tests for the pure pieces of `app/lib/email-login.server.ts`: address
 * normalization and syntax checks, the domain allow-list, the same-origin POST
 * check, and the URLs built from APP_URL.
 *
 * @version v0.4.0
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeEmail,
  isPlausibleEmail,
  parseAllowedDomains,
  isAllowedDomain,
  isSameOriginPost,
  appUrl,
  limitKey,
  verifyTurnstile,
  turnstileExpectation,
  TURNSTILE_ACTION,
  type EmailLoginConfig,
} from "~/lib/email-login.server";

function post(headers: Record<string, string>): Request {
  return new Request("https://ampl.tools/auth/email/request", { method: "POST", headers });
}

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Ana.Perez@UCSB.EDU \n")).toBe("ana.perez@ucsb.edu");
  });
  it("strips exactly what the migration strips: space, tab, LF, CR", () => {
    expect(normalizeEmail("\t\r\n A@X.COM \r\n\t")).toBe("a@x.com");
    // Other whitespace is not trimmed (SQLite trim() with that set would not
    // either); the syntax check then rejects the address.
    expect(normalizeEmail("\u00a0a@x.com")).toBe("\u00a0a@x.com");
    expect(normalizeEmail("a@x.com\u2003")).toBe("a@x.com\u2003");
  });
  it("lower-cases ASCII only, as SQLite lower() does", () => {
    expect(normalizeEmail("ÉLAN@X.COM")).toBe("Élan@x.com");
  });
});

describe("limitKey", () => {
  it("drops a +tag from the local part and keeps the domain", () => {
    expect(limitKey("person+1@ucsb.edu")).toBe("person@ucsb.edu");
    expect(limitKey("person+a+b@ucsb.edu")).toBe("person@ucsb.edu");
    expect(limitKey("person@ucsb.edu")).toBe("person@ucsb.edu");
  });
});

describe("isPlausibleEmail", () => {
  it.each(["a@ucsb.edu", "first.last+tag@ucsb.edu"])("accepts %s", (v) => {
    expect(isPlausibleEmail(v)).toBe(true);
  });
  it.each(["", "a", "@ucsb.edu", "a@", "a@@ucsb.edu", "a b@ucsb.edu", "a@ucsb", `${"x".repeat(250)}@ucsb.edu`, "a@ucsb.edu\r\nBcc: x@y.z"])(
    "rejects %j",
    (v) => {
      expect(isPlausibleEmail(v)).toBe(false);
    },
  );
});

describe("allowed domains", () => {
  it("parses a comma-separated list, trimmed and lower-cased, empty entries dropped", () => {
    expect(parseAllowedDomains(" UCSB.edu, ,example.org ")).toEqual(["ucsb.edu", "example.org"]);
    expect(parseAllowedDomains(undefined)).toEqual(["ucsb.edu"]);
    expect(parseAllowedDomains("")).toEqual([]);
  });
  it("matches the domain exactly", () => {
    const domains = ["ucsb.edu"];
    expect(isAllowedDomain("a@ucsb.edu", domains)).toBe(true);
    expect(isAllowedDomain("a@cs.ucsb.edu", domains)).toBe(false);
    expect(isAllowedDomain("a@notucsb.edu", domains)).toBe(false);
    expect(isAllowedDomain("a@ucsb.edu.evil.com", domains)).toBe(false);
    expect(isAllowedDomain("a@ucsb.edu", [])).toBe(false);
  });
});

describe("isSameOriginPost", () => {
  const app = "https://ampl.tools";
  it("accepts Sec-Fetch-Site: same-origin", () => {
    expect(isSameOriginPost(post({ "Sec-Fetch-Site": "same-origin" }), app)).toBe(true);
    expect(isSameOriginPost(post({ "Sec-Fetch-Site": "same-origin", Origin: "null" }), app)).toBe(true);
    expect(isSameOriginPost(post({ "Sec-Fetch-Site": "same-origin", Origin: app }), app)).toBe(true);
  });
  it("accepts a matching Origin when Sec-Fetch-Site is absent", () => {
    expect(isSameOriginPost(post({ Origin: app }), app)).toBe(true);
  });
  it.each([
    [{ "Sec-Fetch-Site": "cross-site" }],
    [{ "Sec-Fetch-Site": "same-site" }],
    [{ "Sec-Fetch-Site": "none" }],
    [{ "Sec-Fetch-Site": "same-origin", Origin: "https://evil.example" }],
    [{ Origin: "https://evil.example" }],
    [{ Origin: "https://ampl.tools.evil.example" }],
    [{ Origin: "http://ampl.tools" }],
    [{ Origin: "null" }],
    [{}],
  ])("rejects %j", (headers) => {
    expect(isSameOriginPost(post(headers as Record<string, string>), app)).toBe(false);
  });
});

describe("appUrl", () => {
  it("uses only the origin of APP_URL and adds the /auth base path", () => {
    expect(appUrl("https://ampl.tools/auth", "/email/verify")).toBe("https://ampl.tools/auth/email/verify");
    expect(appUrl("https://auth-staging.example", "/login")).toBe(
      "https://auth-staging.example/auth/login",
    );
  });
});

// Turnstile hostname and action checks

function stubSiteverify(payload: Record<string, unknown>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json(payload));
}

describe("verifyTurnstile expectations", () => {
  const expected = { hostname: "ampl.tools", action: TURNSTILE_ACTION };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when success, hostname and action all match", async () => {
    stubSiteverify({ success: true, hostname: "ampl.tools", action: TURNSTILE_ACTION });
    expect(await verifyTurnstile("secret", "token", null, expected)).toBe(true);
  });

  it("fails when the hostname differs", async () => {
    stubSiteverify({ success: true, hostname: "evil.example", action: TURNSTILE_ACTION });
    expect(await verifyTurnstile("secret", "token", null, expected)).toBe(false);
  });

  it("fails when the action differs or is missing", async () => {
    stubSiteverify({ success: true, hostname: "ampl.tools", action: "other" });
    expect(await verifyTurnstile("secret", "token", null, expected)).toBe(false);
    vi.restoreAllMocks();
    stubSiteverify({ success: true, hostname: "ampl.tools" });
    expect(await verifyTurnstile("secret", "token", null, expected)).toBe(false);
  });

  it("fails when success is false even if hostname and action match", async () => {
    stubSiteverify({ success: false, hostname: "ampl.tools", action: TURNSTILE_ACTION });
    expect(await verifyTurnstile("secret", "token", null, expected)).toBe(false);
  });

  it("ignores hostname and action when expected is null", async () => {
    stubSiteverify({ success: true, hostname: "example.com", action: "x" });
    expect(await verifyTurnstile("secret", "token", null, null)).toBe(true);
  });
});

describe("turnstileExpectation", () => {
  const base: EmailLoginConfig = {
    enabled: true,
    domains: ["ucsb.edu"],
    turnstileSiteKey: "0x4AAAAAAAreal-looking-key",
    turnstileSecret: "secret",
    appUrl: "https://ampl.tools/auth",
    appOrigin: "https://ampl.tools",
  };

  it("returns null for Cloudflare's test site keys", () => {
    expect(turnstileExpectation({ ...base, turnstileSiteKey: "1x00000000000000000000AA" })).toBeNull();
    expect(turnstileExpectation({ ...base, turnstileSiteKey: "2x00000000000000000000AB" })).toBeNull();
    expect(turnstileExpectation({ ...base, turnstileSiteKey: "3x00000000000000000000FF" })).toBeNull();
  });

  it("returns the APP_URL hostname and the action for a real key", () => {
    expect(turnstileExpectation(base)).toEqual({
      hostname: "ampl.tools",
      action: TURNSTILE_ACTION,
    });
  });
});
