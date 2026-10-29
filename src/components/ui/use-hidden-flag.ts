import { useState } from "react";
import {
  runOnJS,
  useAnimatedReaction,
  type SharedValue,
} from "react-native-reanimated";

/**
 * Whether a 0-1 `visibility` value has dropped below `threshold`, as React state.
 *
 * Touch routing belongs on the view's `pointerEvents` prop, not in an animated style: a prop the
 * UI thread patches into a style is not guaranteed to reach hit-testing on every platform, and a
 * floating button that has faded out must not stay tappable. The state flips once per crossing,
 * not once per frame.
 */
export function useHiddenFlag(
  visibility: SharedValue<number> | undefined,
  threshold = 0.5,
) {
  const [hidden, setHidden] = useState(
    () => visibility !== undefined && visibility.get() < threshold,
  );
  useAnimatedReaction(
    () => (visibility ? visibility.get() < threshold : false),
    (next, previous) => {
      if (next !== previous) runOnJS(setHidden)(next);
    },
    [visibility, threshold],
  );
  return hidden;
}
