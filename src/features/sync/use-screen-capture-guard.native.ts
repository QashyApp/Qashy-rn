/**
 * Keeps a screen out of screenshots and screen recordings while secret text is on it.
 *
 * `preventScreenCaptureAsync` covers screenshots and recordings on both platforms (Android uses
 * FLAG_SECURE, which also blanks the app-switcher snapshot). iOS additionally needs the
 * app-switcher blur, because iOS snapshots the window when the app leaves the foreground.
 *
 * Native only. Each caller passes its own `key` so two screens cannot release each other's block.
 */

import * as ScreenCapture from "expo-screen-capture";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

export function usePreventScreenCaptureWhile(
  active: boolean,
  key: string,
  onFailure?: () => void,
) {
  // The effect below only re-runs when `active` or `key` change, so the latest failure handler
  // is read through a ref instead of being a dependency that would re-arm the block every render.
  const failureRef = useRef(onFailure);
  useEffect(() => {
    failureRef.current = onFailure;
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const protect = async () => {
      await ScreenCapture.preventScreenCaptureAsync(key);
      // The cleanup may have run while the block was being set. Enabling app-switcher protection
      // now would leave it on after the screen that asked for it has gone.
      if (cancelled) return;
      if (Platform.OS === "ios") {
        await ScreenCapture.enableAppSwitcherProtectionAsync();
      }
    };
    protect().catch(() => {
      // Secret text must not stay on screen unprotected, so the owner decides what to hide.
      if (!cancelled) failureRef.current?.();
    });
    return () => {
      cancelled = true;
      void ScreenCapture.allowScreenCaptureAsync(key).catch(() => undefined);
      if (Platform.OS === "ios") {
        void ScreenCapture.disableAppSwitcherProtectionAsync().catch(
          () => undefined,
        );
      }
    };
  }, [active, key]);
}
