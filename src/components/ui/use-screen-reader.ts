import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Whether a screen reader (TalkBack, VoiceOver, a web reader the browser reports) is running. */
export function useScreenReaderEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    if (typeof AccessibilityInfo?.isScreenReaderEnabled === "function") {
      AccessibilityInfo.isScreenReaderEnabled().then(
        (value) => {
          if (live) setEnabled(value);
        },
        () => {},
      );
    }
    const subscription = AccessibilityInfo?.addEventListener?.(
      "screenReaderChanged",
      setEnabled,
    );
    return () => {
      live = false;
      subscription?.remove();
    };
  }, []);
  return enabled;
}
