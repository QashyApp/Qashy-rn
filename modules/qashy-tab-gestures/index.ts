import { Platform } from "react-native";

import NativeModule, {
  type TabGesturesSubscription,
  type TabLongPressEvent,
} from "./src/QashyTabGesturesModule";

export type { TabGesturesSubscription, TabLongPressEvent };

/**
 * Calls `listener` when an item of Android's native bottom navigation bar is long-pressed. Returns
 * a subscription to remove, or null on web, iOS, or when the native module is not part of the build.
 * Never throws.
 */
export function addTabLongPressListener(
  listener: (event: TabLongPressEvent) => void,
): TabGesturesSubscription | null {
  if (Platform.OS !== "android" || !NativeModule) return null;
  try {
    return NativeModule.addListener("onTabLongPress", listener);
  } catch {
    return null;
  }
}
