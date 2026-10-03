import { Platform } from "react-native";

import NativeModule, {
  type SystemPalettes,
} from "./src/QashyDynamicColorsModule";

export type {
  SystemPalettes,
  TonalPalette,
} from "./src/QashyDynamicColorsModule";

/**
 * The Android 12+ system tonal palettes as `#RRGGBB` strings, or null on web, iOS, below Android
 * 12, or when the native module is not part of the build. Never throws.
 */
export function readSystemPalettes(): SystemPalettes | null {
  if (Platform.OS !== "android" || !NativeModule) return null;
  try {
    const palettes = NativeModule.isAvailable()
      ? NativeModule.getPalettes()
      : null;
    return palettes ?? null;
  } catch {
    return null;
  }
}
