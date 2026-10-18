import { Platform } from "react-native";

import NativeModule from "./src/QashyLocaleModule";

/** True on Android builds that include the native module. */
export function isAvailable(): boolean {
  return Platform.OS === "android" && NativeModule != null;
}

/**
 * The per-app locale list as comma-separated BCP-47 tags. "" means follow the system, and is
 * also what web or a build without the native module returns. Never throws.
 */
export function getApplicationLocales(): string {
  if (Platform.OS !== "android" || !NativeModule) return "";
  try {
    return NativeModule.getApplicationLocales() ?? "";
  } catch {
    return "";
  }
}

/**
 * Sets the per-app locale list (comma-separated BCP-47 tags); "" resets to the system default.
 * A no-op on web or without the native module.
 */
export async function setApplicationLocales(tags: string): Promise<void> {
  if (Platform.OS !== "android" || !NativeModule) return;
  await NativeModule.setApplicationLocales(tags);
}

/** The system (not per-app) locale list as BCP-47 tags; [] on web or when unavailable. */
export function getSystemLocales(): string[] {
  if (Platform.OS !== "android" || !NativeModule) return [];
  try {
    return (NativeModule.getSystemLocales() ?? "").split(",").filter(Boolean);
  } catch {
    return [];
  }
}
