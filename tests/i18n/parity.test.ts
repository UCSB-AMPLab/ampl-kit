/**
 * In-pool i18n parity trip-wire
 *
 * These tests are a local belt-and-braces mirror of the canonical CI gate in
 * `scripts/check-i18n-parity.mjs`. The script itself cannot run inside the
 * `@cloudflare/vitest-pool-workers` pool — the Workers runtime has no
 * `node:child_process` to spawn it, and standing up a separate node pool for a
 * single test would add disproportionate config — so instead these tests
 * reproduce the script's logic in-pool, against the very same `~/locales`
 * resource graph the running app consumes. They catch the two failure modes
 * that matter: key-set drift between the English and Spanish translations
 * (per namespace), and the placeholder sentinel value surviving in either
 * language. CI still runs the script as the authoritative gate; this is the
 * fast local warning.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from "vitest";
import resources from "~/locales";

const SENTINEL = "TRANSLATION_NEEDED";

function flatten(obj: Record<string, unknown>, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [childKey, childVal] of flatten(v as Record<string, unknown>, key)) {
        out.set(childKey, childVal);
      }
    } else {
      out.set(key, v);
    }
  }
  return out;
}

describe("i18n parity (mirror of scripts/check-i18n-parity.mjs)", () => {
  const enNamespaces = Object.keys(resources.en).sort();
  const esNamespaces = Object.keys(resources.es).sort();

  it("namespace presence parity (en vs es)", () => {
    expect(enNamespaces).toEqual(esNamespaces);
  });

  for (const namespace of enNamespaces) {
    it(`namespace "${namespace}" -key sets identical across en/es`, () => {
      const enFlat = flatten(
        (resources.en as Record<string, Record<string, unknown>>)[namespace],
      );
      const esFlat = flatten(
        (resources.es as Record<string, Record<string, unknown>>)[namespace],
      );
      expect([...enFlat.keys()].sort()).toEqual([...esFlat.keys()].sort());
    });

    it(`namespace "${namespace}" -no TRANSLATION_NEEDED sentinel remains in en`, () => {
      const flat = flatten(
        (resources.en as Record<string, Record<string, unknown>>)[namespace],
      );
      const offenders = [...flat.entries()]
        .filter(([, v]) => v === SENTINEL)
        .map(([k]) => `en:${namespace}:${k}`);
      expect(offenders).toEqual([]);
    });

    it(`namespace "${namespace}" -no TRANSLATION_NEEDED sentinel remains in es`, () => {
      const flat = flatten(
        (resources.es as Record<string, Record<string, unknown>>)[namespace],
      );
      const offenders = [...flat.entries()]
        .filter(([, v]) => v === SENTINEL)
        .map(([k]) => `es:${namespace}:${k}`);
      expect(offenders).toEqual([]);
    });
  }
});
