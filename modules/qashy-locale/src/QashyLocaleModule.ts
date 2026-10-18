import { requireOptionalNativeModule } from "expo-modules-core";

interface NativeModule {
  getApplicationLocales(): string;
  setApplicationLocales(tags: string): Promise<void>;
  getSystemLocales(): string;
  getStrings(names: string[], localeTag: string): Promise<(string | null)[]>;
}

// Optional: the module only exists in an Android dev-client / release build that includes it.
// Web, Expo Go and Jest resolve to null and callers fall back to the JS-side language choice.
export default requireOptionalNativeModule<NativeModule>("QashyLocale");
