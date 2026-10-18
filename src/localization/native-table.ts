/**
 * Translations of a Play-translated language, read from Android string resources.
 *
 * Only English text and names are bundled in the app: the HEBREW keys, and the slim
 * `android-runtime.json` (the resource name of every key and the dynamic patterns, both
 * precomputed by `npm run strings:android` so nothing is hashed at runtime). The translations
 * themselves are never bundled: they live in the resources Google Play delivers, and one
 * `getStrings` call per locale reads them. Every missing entry stays English.
 */

import * as QashyLocale from "../../modules/qashy-locale";
import runtime from "@/localization/android-runtime.json";
import { HEBREW } from "@/localization/messages/he";
import { formatResource } from "@/localization/resource-names";

export type NativePattern = {
  regex: RegExp;
  /** The translated `%n$s` template, or null when this pattern has none (the message stays English). */
  template: string | null;
};

export type NativeTable = {
  /** English text to its translation. */
  strings: ReadonlyMap<string, string>;
  /**
   * Every dynamic pattern in the Hebrew table's own order; the first match wins, as it does
   * there. A pattern without a translation still claims its messages, so a broader pattern
   * further down can never translate a message the Hebrew table assigns to another pattern.
   */
  patterns: readonly NativePattern[];
};

export const EMPTY_NATIVE_TABLE: NativeTable = {
  strings: new Map(),
  patterns: [],
};

// Keyed by the full locale tag (`fr-FR`, not `fr`): resources can differ by region.
const tables = new Map<string, NativeTable>();

/** The table in use for a locale tag, if one has been loaded. */
export function getNativeTable(localeTag: string): NativeTable | undefined {
  return tables.get(localeTag);
}

export function setNativeTable(localeTag: string, table: NativeTable) {
  tables.set(localeTag, table);
}

/**
 * Loads the translations of `localeTag` with one `getStrings` call. Null results (no such
 * resource, no native module, web) are ignored. Rejects only if `getStrings` does.
 */
export async function loadNativeTable(localeTag: string): Promise<NativeTable> {
  const keys = Object.keys(HEBREW);
  // Names are precomputed in `Object.keys(HEBREW)` order; a test keeps them aligned.
  const patternNames = runtime.patterns.flatMap((entry) =>
    entry.name === null ? [] : [entry.name],
  );
  const values = await QashyLocale.getStrings(
    [...runtime.strings, ...patternNames],
    localeTag,
  );

  const strings = new Map<string, string>();
  keys.forEach((english, index) => {
    const value = values[index];
    if (value != null) strings.set(english, value);
  });
  const patterns: NativePattern[] = [];
  let next = keys.length;
  for (const { name, source } of runtime.patterns) {
    const template = name === null ? null : (values[next++] ?? null);
    try {
      patterns.push({ regex: new RegExp(source), template });
    } catch {
      // A malformed source can only come from a bad generated file; it can match nothing.
    }
  }
  return { strings, patterns };
}

/** How long one read of a locale's resources may take before it counts as failed. */
export const NATIVE_LOAD_TIMEOUT_MS = 5000;

/**
 * Settles with `load`, or rejects after `ms`, so a read that never settles cannot keep the app
 * waiting. The timer is cleared as soon as the load settles.
 */
export function withTimeout<T>(load: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms} ms`)),
      ms,
    );
    load.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

/** The translation of an already trimmed message, or the message itself. */
export function translateWithTable(core: string, table: NativeTable): string {
  const exact = table.strings.get(core);
  if (exact !== undefined) return exact;
  for (const { regex, template } of table.patterns) {
    const match = regex.exec(core);
    if (!match) continue;
    return template === null ? core : formatResource(template, match.slice(1));
  }
  return core;
}
