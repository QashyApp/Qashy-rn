/**
 * Android: reads a Play-translated locale's string resources into a `NativeTable`.
 *
 * Names are precomputed by `npm run strings:android` into `android-runtime.json` (the resource
 * name of every HEBREW key, in `Object.keys(HEBREW)` order, and the dynamic patterns), so
 * nothing is hashed at runtime. A test keeps the file aligned with the dictionary.
 */

import * as QashyLocale from "../../modules/qashy-locale";
import runtime from "@/localization/android-runtime.json";
import { HEBREW } from "@/localization/messages/he";
import {
  EMPTY_NATIVE_TABLE,
  type NativePattern,
  type NativeTable,
} from "@/localization/native-table";

/**
 * Loads the translations of `localeTag` with one `getStrings` call. Null results (no such
 * resource) are ignored. Rejects if the native read does. Without the native module, or when
 * every value comes back null, there is nothing to show, so it returns `EMPTY_NATIVE_TABLE`:
 * the caller treats that as not loaded, never as a good table, and retries on a later visit.
 */
export async function loadNativeTable(localeTag: string): Promise<NativeTable> {
  if (!QashyLocale.isAvailable()) return EMPTY_NATIVE_TABLE;
  const keys = Object.keys(HEBREW);
  const patternNames = runtime.patterns.flatMap((entry) =>
    entry.name === null ? [] : [entry.name],
  );
  const values = await QashyLocale.getStrings(
    [...runtime.strings, ...patternNames],
    localeTag,
  );

  if (values.every((value) => value == null)) return EMPTY_NATIVE_TABLE;

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
