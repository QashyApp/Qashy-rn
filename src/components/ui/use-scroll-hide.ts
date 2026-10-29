import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { getFloatingBarVisibility } from "@/components/navigation/floating-bar-visibility";
import {
  ReduceMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { motionCurves, useMotionPreference } from "@/components/ui/motion";
import {
  accumulateTravel,
  travelDirection,
} from "@/components/ui/scroll-direction";

const ALWAYS_SHOW_OFFSET = 32;
const HIDE_AFTER_OFFSET = 80;

/**
 * Tracks scroll direction and exposes a 0–1 visibility value: scrolling down
 * hides (0), scrolling up or resting near the top shows (1). Attach `onScroll`
 * to a scrollable (with `scrollEventThrottle={16}`) and hand `visibility` to
 * `FloatingActionButton`.
 *
 * The direction has to hold for 20 dp before it flips (see `scroll-direction.ts`), so a slow scroll
 * up still reveals the button and a wobbling finger does not flicker it.
 */
export function useScrollHide() {
  const visibility = useSharedValue(1);
  const lastOffset = useRef(0);
  const travel = useRef(0);
  const shown = useRef(true);
  const { instant, travel: moves } = useMotionPreference();
  // The motion preference can change while the list is on screen; `onScroll` reads it from here so
  // that it can stay the same function for the screen's whole life (memoised pages depend on that).
  const motion = useRef({ instant, moves });
  useEffect(() => {
    motion.current = { instant, moves };
  }, [instant, moves]);

  const setShown = useCallback(
    (next: boolean) => {
      if (shown.current === next) return;
      shown.current = next;
      // A quick fade at every level but `off`, which changes instantly. Without travel (Minimal) the
      // fade is the whole effect, so it is shorter still.
      const timing = {
        duration: motion.current.moves ? 200 : 120,
        easing: motionCurves.standard,
        reduceMotion: motion.current.instant
          ? ReduceMotion.Always
          : ReduceMotion.System,
      };
      visibility.set(withTiming(next ? 1 : 0, timing));
      // The Android floating tab bar tucks away with the FAB (a no-op for every other bar).
      getFloatingBarVisibility().set(withTiming(next ? 1 : 0, timing));
    },
    [visibility],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      const delta = offset - lastOffset.current;
      lastOffset.current = offset;
      travel.current = accumulateTravel(travel.current, delta);
      const direction = travelDirection(travel.current);
      if (offset <= ALWAYS_SHOW_OFFSET || direction < 0) setShown(true);
      else if (direction > 0 && offset > HIDE_AFTER_OFFSET) setShown(false);
    },
    [setShown],
  );

  return { visibility, onScroll };
}
