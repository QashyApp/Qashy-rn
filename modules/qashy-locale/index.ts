import { Platform } from "react-native";

import NativeModule from "./src/QashyLocaleModule";

/** True on Android builds that include the native module. */
export function isAvailable(): boolean {
  return Platform.OS === "android" && NativeModule != null;
}

/**
 * The per-app locale list as comma-separated BCP-47 tags. "" means follow the system, and is
 * also what web or a build without the native module returns. When the native module is
 * available, a read error propagates: it is not "system", and callers decide what to keep.
 */
export function getApplicationLocales(): string {
  if (Platform.OS !== "android" || !NativeModule) return "";
  return NativeModule.getApplicationLocales() ?? "";
}

/**
 * Sets the per-app locale list (comma-separated BCP-47 tags); "" resets to the system default.
 * A no-op on web or without the native module.
 */
export async function setApplicationLocales(tags: string): Promise<void> {
  if (Platform.OS !== "android" || !NativeModule) return;
  await NativeModule.setApplicationLocales(tags);
}

/**
 * The system (not per-app) locale list as BCP-47 tags; [] on web or when unavailable. When the
 * native module is available, a read error propagates.
 */
export function getSystemLocales(): string[] {
  if (Platform.OS !== "android" || !NativeModule) return [];
  return (NativeModule.getSystemLocales() ?? "").split(",").filter(Boolean);
}

/**
 * Reads Android string resources by name in the given locale (BCP-47 tag), independent of the
 * app's current locale. Each entry is null when the resource does not exist. Locales without
 * translations fall back to the default (English) text, as Android resource lookup does.
 * Resolves to all nulls on web or in a build without the native module. When the native module
 * is available, a failure rejects, so the caller can retry or fall back deliberately.
 */
export async function getStrings(
  names: readonly string[],
  localeTag: string,
): Promise<(string | null)[]> {
  const none = (): null[] => names.map(() => null);
  if (Platform.OS !== "android" || !NativeModule || names.length === 0) {
    return none();
  }
  const result = await NativeModule.getStrings([...names], localeTag);
  return names.map((_, i) => result?.[i] ?? null);
}
