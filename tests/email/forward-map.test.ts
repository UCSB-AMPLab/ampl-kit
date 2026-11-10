/**
 * Unit tests for the inbound forward map parser and lookup.
 *
 * Uses example addresses only. Pure functions; no Worker bindings needed.
 *
 * @version v0.4.0
 */

import { describe, it, expect } from "vitest";
import { parseForwardMap, lookupForward } from "../../app/email/lib/forward-map";

describe("parseForwardMap", () => {
  it("returns an empty map for undefined and empty input", () => {
    expect(parseForwardMap(undefined)).toEqual({});
    expect(parseForwardMap("")).toEqual({});
    expect(parseForwardMap("   ")).toEqual({});
  });

  it("returns an empty map for invalid JSON", () => {
    expect(parseForwardMap("{not json")).toEqual({});
  });

  it("returns an empty map for non-object JSON", () => {
    expect(parseForwardMap("[]")).toEqual({});
    expect(parseForwardMap('["hello@ampl.tools","maintainer@example.org"]')).toEqual({});
    expect(parseForwardMap('"hello@ampl.tools"')).toEqual({});
    expect(parseForwardMap("42")).toEqual({});
    expect(parseForwardMap("null")).toEqual({});
  });

  it("drops entries whose value is not a string", () => {
    const map = parseForwardMap(
      JSON.stringify({
        "hello@ampl.tools": 7,
        "a@ampl.tools": null,
        "b@ampl.tools": ["maintainer@example.org"],
        "c@ampl.tools": "maintainer@example.org",
      }),
    );
    expect(map).toEqual({ "c@ampl.tools": "maintainer@example.org" });
  });

  it("normalizes keys and trims values", () => {
    const map = parseForwardMap(
      JSON.stringify({ "  Hello@AMPL.tools ": "  maintainer@example.org  " }),
    );
    expect(map).toEqual({ "hello@ampl.tools": "maintainer@example.org" });
  });

  it("drops entries whose key or value is not an email address", () => {
    const map = parseForwardMap(
      JSON.stringify({
        "not-an-address": "maintainer@example.org",
        "hello@ampl.tools": "not-an-address",
        "a b@ampl.tools": "maintainer@example.org",
        "privacy@ampl.tools": "maintainer@example.org",
      }),
    );
    expect(map).toEqual({ "privacy@ampl.tools": "maintainer@example.org" });
  });
});

describe("lookupForward", () => {
  const map = { "hello@ampl.tools": "maintainer@example.org" };

  it("resolves a normalized recipient", () => {
    expect(lookupForward(map, " Hello@AMPL.tools ")).toBe("maintainer@example.org");
  });

  it("returns null for a recipient not in the map", () => {
    expect(lookupForward(map, "other@ampl.tools")).toBeNull();
    expect(lookupForward({}, "hello@ampl.tools")).toBeNull();
  });
});
