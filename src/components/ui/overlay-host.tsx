import type { ReactNode } from "react";

/** What a screen's component hands to the overlay host to draw above the whole app. */
export interface OverlayEntry {
  node: ReactNode;
  /** True while the entry is a modal surface: the app behind it is hidden from screen readers. */
  modal: boolean;
}

export interface OverlayApi {
  /** Shows, replaces or (with null) removes the entry stored under `key`. */
  set: (key: string, entry: OverlayEntry | null) => void;
}

/**
 * Web has no overlay host: `Modal` is already a DOM portal in the same document, and pointer events
 * pass through it, so a layer there keeps using `Modal` (see `CalculatorLayer`).
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  return children;
}

/** The overlay host a component can draw into, or null where there is none. */
export function useOverlay(): OverlayApi | null {
  return null;
}
