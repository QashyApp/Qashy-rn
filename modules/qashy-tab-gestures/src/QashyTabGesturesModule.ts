import { requireOptionalNativeModule } from "expo-modules-core";

export interface TabLongPressEvent {
  /** Position of the pressed item in the bar. */
  index: number;
}

export interface TabGesturesSubscription {
  remove(): void;
}

interface NativeModule {
  addListener(
    eventName: "onTabLongPress",
    listener: (event: TabLongPressEvent) => void,
  ): TabGesturesSubscription;
}

// Optional: the module only exists in an Android dev-client / release build that includes it.
// Web, iOS, Expo Go and Jest resolve to null and a long press simply does nothing there.
export default requireOptionalNativeModule<NativeModule>("QashyTabGestures");
