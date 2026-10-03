import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { readSystemPalettes } from "../../modules/qashy-dynamic-colors";
import { isSystemPalettes, type SystemPalettes } from "@/theme/dynamic-palette";

function read(): SystemPalettes | null {
  try {
    const palettes: unknown = readSystemPalettes();
    return isSystemPalettes(palettes) ? palettes : null;
  } catch {
    return null;
  }
}

const sameTones = (
  first: SystemPalettes | null,
  second: SystemPalettes | null,
) => first === second || JSON.stringify(first) === JSON.stringify(second);

/**
 * The Android 12+ wallpaper palettes, or null on web, iOS, older Android, Expo Go and Jest (any
 * build without the local `qashy-dynamic-colors` module). Re-read whenever the app returns to the
 * foreground, since the wallpaper may have changed meanwhile; the state only changes when the
 * colors really did, so nothing re-renders for no reason.
 */
export function useSystemPalettes(enabled = true): SystemPalettes | null {
  const [palettes, setPalettes] = useState<SystemPalettes | null>(() =>
    enabled ? read() : null,
  );
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      const next = read();
      setPalettes((current) => (sameTones(current, next) ? current : next));
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [enabled]);
  return enabled ? palettes : null;
}
