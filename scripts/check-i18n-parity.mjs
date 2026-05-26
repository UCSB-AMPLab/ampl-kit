#!/usr/bin/env node
/**
 * i18n parity gate
 *
 * This script is the authoritative check that the app's two languages stay in
 * lockstep, run as a gate in continuous integration. It reads every namespace
 * file under `app/locales/en/` and `app/locales/es/`, flattens each nested
 * translation file into dot-path keys, and compares the two languages: it fails
 * if a namespace file exists in one language but not the other, if the set of
 * keys diverges (reporting which keys are English-only or Spanish-only), or if
 * any value is still the literal `TRANSLATION_NEEDED` placeholder left in by a
 * translator. On success it prints a one-line summary of how many namespaces
 * and keys it checked and exits 0; on any mismatch it writes a diff-style report
 * to stderr and exits non-zero, which stops the build. It is the production
 * counterpart to the in-pool trip-wire in `tests/i18n/parity.test.ts`.
 *
 * Run:
 *   node scripts/check-i18n-parity.mjs
 *
 * @version v0.1.0
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const LOCALES_DIR = resolve(PROJECT_ROOT, "app", "locales");
const SENTINEL = "TRANSLATION_NEEDED";

/**
 * Flatten a nested object into a Map<dotpath, value>.
 * Arrays are treated as leaf values (we don't index into them for i18n).
 */
function flatten(obj, prefix = "") {
  const out = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [childKey, childVal] of flatten(v, key)) {
        out.set(childKey, childVal);
      }
    } else {
      out.set(key, v);
    }
  }
  return out;
}

async function listJsonNamespaces(localeDir) {
  let entries;
  try {
    entries = await readdir(localeDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

async function loadNamespace(localeDir, namespace) {
  const path = resolve(localeDir, `${namespace}.json`);
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err.message}`);
  }
}

async function main() {
  const enDir = resolve(LOCALES_DIR, "en");
  const esDir = resolve(LOCALES_DIR, "es");

  const [enNamespaces, esNamespaces] = await Promise.all([
    listJsonNamespaces(enDir),
    listJsonNamespaces(esDir),
  ]);

  const errors = [];

  // Namespace presence parity (en vs es).
  const enSet = new Set(enNamespaces);
  const esSet = new Set(esNamespaces);
  const onlyInEn = enNamespaces.filter((ns) => !esSet.has(ns));
  const onlyInEs = esNamespaces.filter((ns) => !enSet.has(ns));
  if (onlyInEn.length > 0) {
    errors.push(
      `Namespace files present in en/ but missing in es/: ${onlyInEn
        .map((n) => `${n}.json`)
        .join(", ")}`,
    );
  }
  if (onlyInEs.length > 0) {
    errors.push(
      `Namespace files present in es/ but missing in en/: ${onlyInEs
        .map((n) => `${n}.json`)
        .join(", ")}`,
    );
  }

  const sharedNamespaces = enNamespaces.filter((ns) => esSet.has(ns));

  let totalKeysPerLocale = 0;

  for (const namespace of sharedNamespaces) {
    const [enJson, esJson] = await Promise.all([
      loadNamespace(enDir, namespace),
      loadNamespace(esDir, namespace),
    ]);

    const enFlat = flatten(enJson);
    const esFlat = flatten(esJson);

    const enKeys = new Set(enFlat.keys());
    const esKeys = new Set(esFlat.keys());

    const enOnly = [...enKeys].filter((k) => !esKeys.has(k)).sort();
    const esOnly = [...esKeys].filter((k) => !enKeys.has(k)).sort();

    if (enOnly.length > 0 || esOnly.length > 0) {
      const lines = [`Key-set divergence in namespace "${namespace}":`];
      if (enOnly.length > 0) {
        for (const k of enOnly) lines.push(`  EN-only: ${namespace}.${k}`);
      }
      if (esOnly.length > 0) {
        for (const k of esOnly) lines.push(`  ES-only: ${namespace}.${k}`);
      }
      errors.push(lines.join("\n"));
    }

    // Sentinel check across BOTH locales.
    for (const [k, v] of enFlat) {
      if (v === SENTINEL) {
        errors.push(`Sentinel value still present: en:${namespace}:${k}`);
      }
    }
    for (const [k, v] of esFlat) {
      if (v === SENTINEL) {
        errors.push(`Sentinel value still present: es:${namespace}:${k}`);
      }
    }

    // Track key-count using EN as canonical (key sets are equal at this point
    // unless errors were already pushed).
    totalKeysPerLocale += enKeys.size;
  }

  if (errors.length > 0) {
    process.stderr.write("i18n parity check FAILED:\n\n");
    for (const e of errors) {
      process.stderr.write(e + "\n");
    }
    process.stderr.write(
      `\nScanned locales: en, es (${sharedNamespaces.length} shared namespaces)\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `i18n parity OK: ${sharedNamespaces.length} namespaces, ${totalKeysPerLocale} keys per locale\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`i18n parity check ERROR: ${err.message}\n`);
  process.exit(2);
});
