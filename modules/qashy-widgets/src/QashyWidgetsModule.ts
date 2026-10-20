import { requireOptionalNativeModule } from "expo-modules-core";

interface NativeModule {
  getPlacedWidgets(): Promise<{ id: number; kind: string }[]>;
  update(json: string): Promise<void>;
  clear(): Promise<void>;
  registerPreviews(): Promise<string>;
  reportHeadlessResult(ok: boolean): void;
}

// Optional: the module only exists in an Android dev-client / release build that includes it.
// Web, Expo Go and Jest resolve to null.
export default requireOptionalNativeModule<NativeModule>("QashyWidgets");
