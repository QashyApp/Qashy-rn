import { requireOptionalNativeModule } from "expo-modules-core";

export type TonalPalette = Record<string, string>;
export interface SystemPalettes {
  accent1: TonalPalette;
  accent2: TonalPalette;
  accent3: TonalPalette;
  neutral1: TonalPalette;
  neutral2: TonalPalette;
}

interface NativeModule {
  isAvailable(): boolean;
  getPalettes(): SystemPalettes | null;
}

// Optional: the module only exists in an Android dev-client / release build that includes it.
// Web, iOS, Expo Go and Jest resolve to null and the caller falls back to the theme's accent.
export default requireOptionalNativeModule<NativeModule>("QashyDynamicColors");
