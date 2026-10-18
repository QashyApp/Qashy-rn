/**
 * Builds the Android string catalog (`android-strings.json`) from the Hebrew
 * message tables. Pure: no I/O, so the generator script and the freshness test
 * share it. Imports carry explicit `.ts` extensions so Node can load this file
 * directly with its native type stripping.
 */

import {
  createDynamicPatterns,
  HEBREW,
  type DynamicPattern,
  type NestedTranslate,
} from "./messages/he.ts";
import {
  formatResource,
  patternFormat,
  patternResourceName,
  resourceName,
} from "./resource-names.ts";

export type CatalogString = { name: string; en: string; he: string };
export type CatalogPattern = {
  name: string;
  source: string;
  en: string;
  he: string;
};
export type AndroidCatalog = {
  version: 1;
  strings: CatalogString[];
  patterns: CatalogPattern[];
};
/**
 * One dynamic pattern as the app sees it at runtime. `name` is null for a pattern that has no
 * Android resource (not expressible as a template): it stays in the list so it still claims
 * the messages it matches, exactly as it does in the Hebrew table, and those stay English.
 */
export type RuntimePattern = { name: string | null; source: string };
/**
 * The slim runtime data the app imports instead of the catalog, which also carries every
 * string's English and Hebrew text and would roughly double the dictionary weight.
 * `strings` holds the resource name of each HEBREW key, in `Object.keys(HEBREW)` order, so the
 * app never hashes at runtime. `patterns` is every dynamic pattern in the Hebrew table's own
 * order: the first match wins there, and the app has to pick the same one.
 */
export type AndroidRuntime = { strings: string[]; patterns: RuntimePattern[] };
export type SkippedPattern = { source: string; reason: string };

// Private-use delimiters keep the placeholder intact through the Hebrew function.
const open = "\uE000";
const close = "\uE001";
// Marks output that went through a nested translation, which a template cannot express.
const taint = "\uE002";
const taintingTranslate: NestedTranslate = (message) => `${taint}${message}`;

const SAMPLE_ARGS: readonly (readonly string[])[] = [
  ["12", "7", "3", "40", "5", "6"],
  ["1", "2", "3", "4", "5", "6"],
  ["word", "other", "third", "fourth", "fifth", "sixth"],
  ["Rent", "2025-01-31", "3", "4", "5", "6"],
  ["Food & Drink", "Rent", "Savings", "Travel", "Gifts", "Fees"],
];

/** Number of capture groups in a regex of the shape `patternFormat` accepts. */
function groupCount(format: string): number {
  return new Set(format.match(/%(\d+)\$s/g)).size;
}

function compareNames(a: { name: string }, b: { name: string }) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Hebrew format string for a pattern, or a reason it cannot be expressed. */
function hebrewFormat(
  replacement: (...parts: string[]) => string,
  count: number,
): string {
  const placeholders = Array.from(
    { length: count },
    (_, index) => `${open}${index + 1}${close}`,
  );
  const raw = replacement(...placeholders);
  return raw
    .replace(/%/g, "%%")
    .replace(
      new RegExp(`${open}(\\d+)${close}`, "g"),
      (_match, index: string) => `%${index}$s`,
    );
}

function roundTrips(
  regex: RegExp,
  replacement: (...parts: string[]) => string,
  en: string,
  he: string,
  count: number,
): string | null {
  let matched = 0;
  for (const sample of SAMPLE_ARGS) {
    const args = sample.slice(0, count);
    const english = formatResource(en, args);
    const match = regex.exec(english);
    if (!match) continue;
    if (match.slice(1).join("\u0000") !== args.join("\u0000")) {
      return "captures differ from the arguments";
    }
    if (replacement(...args) !== formatResource(he, args)) {
      return "Hebrew function is not a pure template";
    }
    matched += 1;
  }
  return matched > 0 ? null : "no sample arguments satisfy the regex";
}

export function buildAndroidCatalog(
  hebrew: Readonly<Record<string, string>> = HEBREW,
  createPatterns: (
    translate: NestedTranslate,
  ) => DynamicPattern[] = createDynamicPatterns,
): {
  catalog: AndroidCatalog;
  runtime: AndroidRuntime;
  skipped: SkippedPattern[];
} {
  // Names hash the raw key, but lookups use the trimmed message, so a key with outer
  // whitespace could never be found.
  for (const key of Object.keys(hebrew)) {
    if (key !== key.trim()) {
      throw new Error(
        `HEBREW key has leading or trailing whitespace: ${JSON.stringify(key)}`,
      );
    }
  }
  const seen = new Map<string, string>();
  const claim = (name: string, label: string) => {
    const previous = seen.get(name);
    if (previous !== undefined) {
      throw new Error(
        `Android string name collision on ${name}: ${JSON.stringify(previous)} and ${JSON.stringify(label)}`,
      );
    }
    seen.set(name, label);
  };

  const strings: CatalogString[] = Object.entries(hebrew).map(([en, he]) => {
    const name = resourceName(en);
    claim(name, en);
    return { name, en, he };
  });

  const runtimeStrings = strings.map((entry) => entry.name);
  const patterns: CatalogPattern[] = [];
  const runtimePatterns: RuntimePattern[] = [];
  const skipped: SkippedPattern[] = [];
  const skip = (regex: RegExp, reason: string) => {
    skipped.push({ source: regex.source, reason });
    runtimePatterns.push({ name: null, source: regex.source });
  };
  for (const [regex, replacement] of createPatterns(taintingTranslate)) {
    const en = patternFormat(regex);
    if (en === null) {
      skip(regex, "not a plain literal pattern");
      continue;
    }
    const count = groupCount(en);
    const he = hebrewFormat(replacement, count);
    if (he.includes(taint)) {
      skip(regex, "translates a captured fragment");
      continue;
    }
    const failure = roundTrips(regex, replacement, en, he, count);
    if (failure !== null) {
      skip(regex, failure);
      continue;
    }
    const name = patternResourceName(regex);
    claim(name, `pattern:${regex.source}`);
    patterns.push({ name, source: regex.source, en, he });
    runtimePatterns.push({ name, source: regex.source });
  }

  // Strings are sorted for a stable file; patterns keep the Hebrew table's match order.
  strings.sort(compareNames);
  return {
    catalog: { version: 1, strings, patterns },
    runtime: { strings: runtimeStrings, patterns: runtimePatterns },
    skipped,
  };
}
