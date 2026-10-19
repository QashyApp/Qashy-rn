/**
 * Translations of a Play-translated language, read from Android string resources.
 *
 * This file holds what every platform shares: the table types, the table store, and the
 * lookup. The loader is split by platform (`native-table-loader.native.ts` reads the resources
 * and bundles `android-runtime.json`; `native-table-loader.web.ts` is a stub), because Play
 * languages exist on Android only and the web bundle should not carry that list.
 *
 * Only English text and names are bundled in the app. The translations themselves never are:
 * they live in the resources Google Play delivers, and one `getStrings` call per locale reads
 * them. Every missing entry stays English.
 */

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

/** Forgets every loaded table. For tests, which share module state between cases. */
export function clearNativeTables() {
  tables.clear();
}

export function setNativeTable(localeTag: string, table: NativeTable) {
  tables.set(localeTag, table);
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
