import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { BackHandler } from "react-native";

/**
 * While `active` (Overview is in edit mode), the Android hardware back button and the web Escape
 * key call `onExit` instead of leaving the screen, the same as pressing Done.
 *
 * It listens only while the screen is focused: the tabs stay mounted, and a sheet or screen
 * pushed on top has its own back handling.
 */
export function useExitEditOnBack(active: boolean, onExit: () => void): void {
  const latest = useRef(onExit);
  useEffect(() => {
    latest.current = onExit;
  }, [onExit]);

  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      if (process.env.EXPO_OS === "android") {
        const subscription = BackHandler.addEventListener(
          "hardwareBackPress",
          () => {
            latest.current();
            return true;
          },
        );
        return () => subscription.remove();
      }
      if (process.env.EXPO_OS === "web" && typeof document !== "undefined") {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          event.preventDefault();
          latest.current();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
      }
    }, [active]),
  );
}
