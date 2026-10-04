import { useScrollToTop } from "expo-router";
import { useRef, type RefObject } from "react";

/**
 * Pressing the tab of the section you are already in scrolls it back to the top.
 *
 * Returns a ref to hand to the section's `ScrollView` or `SectionList`. The tab bars emit
 * `tabPress` (the Android floating bar and the web rail do, the native iOS tab bar handles it
 * itself) and `useScrollToTop` answers it only while this screen is the focused one, so a press
 * that is changing sections is left alone. Call it from a route screen: it needs the navigator.
 */
export function useSectionScrollToTop<T>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useScrollToTop(ref as Parameters<typeof useScrollToTop>[0]);
  return ref;
}
