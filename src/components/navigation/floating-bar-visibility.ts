import { makeMutable, type SharedValue } from "react-native-reanimated";

let visibility: SharedValue<number> | null = null;

/**
 * A 0-1 value (1 = shown) that the floating tab bar follows. `useScrollHide` writes it alongside the
 * FAB's own visibility, so the bar tucks away on scroll exactly as the native bar does with
 * `minimizeBehavior="onScrollDown"`. It is created lazily so importing this stays free of side effects.
 */
export function getFloatingBarVisibility(): SharedValue<number> {
  if (!visibility) visibility = makeMutable(1);
  return visibility;
}
