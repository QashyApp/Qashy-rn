import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";

import type { OverlayApi, OverlayEntry } from "./overlay-host";

export type { OverlayApi, OverlayEntry } from "./overlay-host";

const OverlayContext = createContext<OverlayApi | null>(null);

/**
 * A layer drawn above the whole navigator, in the app's own window.
 *
 * React Native's `Modal` is a separate dialog window on Android: while it is up it swallows every
 * touch, even where its content is transparent and `pointerEvents="none"`, and it takes a window's
 * worth of work to build each time. This host sits after the navigator in the root layout instead, so
 * it paints over every screen (react-native-screens adds the stack's screens, transparent-modal
 * sheets included, as views of the same window, and a later sibling draws above them) and a layer in it
 * stays an ordinary view that can be made touch-transparent.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, OverlayEntry>>({});
  const api = useMemo<OverlayApi>(
    () => ({
      set: (key, entry) =>
        setEntries((current) => {
          if (!entry) {
            if (!(key in current)) return current;
            const { [key]: _removed, ...rest } = current;
            return rest;
          }
          const existing = current[key];
          if (
            existing &&
            existing.node === entry.node &&
            existing.modal === entry.modal
          ) {
            return current;
          }
          return { ...current, [key]: entry };
        }),
    }),
    [],
  );
  const list = Object.entries(entries);
  const modal = list.some(([, entry]) => entry.modal);
  return (
    <OverlayContext value={api}>
      {/* While a modal layer is up, what is behind it is out of reach of TalkBack, as under a `Modal`. */}
      <View
        style={{ flex: 1 }}
        importantForAccessibility={modal ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={modal}
      >
        {children}
      </View>
      {/* Covers the full window (the app is edge-to-edge, so this includes the system bars). Empty
          space in it must never catch a touch. */}
      <View pointerEvents="box-none" style={{ position: "absolute", inset: 0 }}>
        {list.map(([key, entry]) => (
          <View
            key={key}
            pointerEvents="box-none"
            style={{ position: "absolute", inset: 0 }}
          >
            {entry.node}
          </View>
        ))}
      </View>
    </OverlayContext>
  );
}

/** The overlay host a component can draw into, or null where there is none. */
export function useOverlay(): OverlayApi | null {
  return use(OverlayContext);
}
