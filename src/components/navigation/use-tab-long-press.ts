import { useEffect, useRef } from "react";

import { addTabLongPressListener } from "../../../modules/qashy-tab-gestures";

/**
 * Calls `onLongPress` when an item of Android's native bottom bar is long-pressed. A no-op on every
 * other platform, and in a build without the local `qashy-tab-gestures` module (Expo Go, Jest).
 */
export function useTabLongPress(onLongPress: () => void) {
  const latest = useRef(onLongPress);
  useEffect(() => {
    latest.current = onLongPress;
  }, [onLongPress]);
  useEffect(() => {
    const subscription = addTabLongPressListener(() => latest.current());
    return () => subscription?.remove();
  }, []);
}
