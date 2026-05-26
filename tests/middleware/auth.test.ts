/**
 * Return-to safety guard tests
 *
 * These tests cover the `safeReturnTo` helper that the auth middleware uses to
 * sanitise a `return_to` destination before redirecting a user back after
 * sign-in. They matter because that value is attacker-influenced: if it were
 * trusted blindly, a crafted link could bounce a freshly-authenticated user to
 * an external site (an open redirect). The tests confirm that genuine in-app
 * apex paths — `/palaeography/dashboard` and the like — pass through unchanged
 * (query string and all, and crucially without stripping the leading path
 * segment), while every dangerous shape is rejected down to a plain `/`:
 * protocol-relative `//host` URLs, absolute `http(s)://` URLs, backslash tricks,
 * and embedded `javascript:`/`data:` schemes.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import { safeReturnTo } from "@ampl/kit/auth";

describe("safeReturnTo", () => {
  it.each([
    // Valid apex paths — returned unchanged (NOT basename-stripped)
    ["/palaeography/dashboard", "/palaeography/dashboard"],
    ["/scheduling/admin", "/scheduling/admin"],
    ["/", "/"],
    ["/palaeography/dashboard?tab=work", "/palaeography/dashboard?tab=work"],
    // Invalid / dangerous inputs — all return "/"
    [null, "/"],
    ["", "/"],
    ["relative-no-slash", "/"],
    ["relative/path", "/"],
    ["//evil.example", "/"],
    ["//evil.com/path", "/"],
    ["/path\\with\\backslash", "/"],
    ["\\\\evil.example", "/"],
    ["http://evil.example/path", "/"],
    ["https://evil.example/path", "/"],
    ["javascript:alert(1)", "/"],
    ["javascript:void(0)", "/"],
  ])("safeReturnTo(%j) => %j", (input, expected) => {
    expect(safeReturnTo(input as string | null)).toBe(expected);
  });

  it("preserves the full apex path without basename-stripping", () => {
    // /palaeography/dashboard is returned as-is.
    // ampl-auth must preserve apex paths unchanged (must NOT strip a leading path segment).
    const result = safeReturnTo("/palaeography/dashboard");
    expect(result).toBe("/palaeography/dashboard");
    expect(result).not.toBe("/dashboard");
  });

  it("preserves query string on valid apex paths", () => {
    const result = safeReturnTo("/palaeography/manuscripts?page=2&filter=latin");
    expect(result).toBe("/palaeography/manuscripts?page=2&filter=latin");
  });

  it("rejects protocol-relative URLs starting with //", () => {
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("//example.com/innocent-path")).toBe("/");
  });

  it("rejects any path containing a backslash", () => {
    expect(safeReturnTo("/path\\evil")).toBe("/");
    expect(safeReturnTo("/path/normal\\evil")).toBe("/");
  });

  it("rejects embedded scheme (cross-origin escape)", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
    expect(safeReturnTo("data:text/html,<script>alert(1)</script>")).toBe("/");
  });
});
