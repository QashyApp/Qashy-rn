import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { getFloatingBarVisibility } from "@/components/navigation/floating-bar-visibility";
import {
  ReduceMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  motionCurves,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion";
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
  // Set by `show`: the next scroll event belongs to a different list, so it only re-bases the offset.
  const rebase = useRef(false);
  const { instant } = useMotionPreference();
  const durations = useMotionDurations();
  // The motion preference can change while the list is on screen; `onScroll` reads it from here so
  // that it can stay the same function for the screen's whole life (memoised pages depend on that).
  const motion = useRef({ instant, durations });
  useEffect(() => {
    motion.current = { instant, durations };
  }, [instant, durations]);

  const setShown = useCallback(
    (next: boolean) => {
      if (shown.current === next) return;
      shown.current = next;
      // The theme's durations (already shortened at Minimal): arriving takes the entrance time,
      // tucking away the faster exit time. `off` changes instantly.
      const timing = {
        duration: next
          ? motion.current.durations.enter
          : motion.current.durations.exit,
        easing: next ? motionCurves.standard : motionCurves.exit,
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
      const delta = rebase.current ? 0 : offset - lastOffset.current;
      rebase.current = false;
      lastOffset.current = offset;
      travel.current = accumulateTravel(travel.current, delta);
      const direction = travelDirection(travel.current);
      if (offset <= ALWAYS_SHOW_OFFSET || direction < 0) setShown(true);
      else if (direction > 0 && offset > HIDE_AFTER_OFFSET) setShown(false);
    },
    [setShown],
  );

  /**
   * Shows the button now, whatever the last scroll was, and forgets the direction so far. For a
   * change of list (another month's page): the old list's scrolling says nothing about the new
   * one, and the next scroll event re-syncs from the new list's offset.
   */
  const show = useCallback(() => {
    travel.current = 0;
    rebase.current = true;
    setShown(true);
  }, [setShown]);

  return { visibility, onScroll, show };
}
