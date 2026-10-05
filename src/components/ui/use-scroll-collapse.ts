import { useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  Easing,
  ReduceMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";

const EXPANDED_UNTIL_OFFSET = 32;
const COLLAPSE_AFTER_OFFSET = 96;
const DIRECTION_THRESHOLD = 6;
/**
 * Collapsing resizes the list under the finger, which can itself move the scroll offset (a short
 * list clamps). Scroll events inside this window are the resize talking, not the user.
 */
const SETTLE_MS = 320;
/**
 * Folding hands the list this much more room (and the same much less content to scroll). A list
 * that would be left with less than this much to scroll afterwards is not worth collapsing: the
 * offset would be clamped back to the top, which reads as "scrolled up" and expands it again,
 * round and round.
 */
const MIN_SCROLL_TO_COLLAPSE = 120;
const AT_END_SLACK = 2;

/**
 * Tracks scroll direction and exposes a 0–1 collapse value: scrolling down collapses (1),
 * scrolling up or resting near the top expands (0). Attach `onScroll` to a scrollable with
 * `scrollEventThrottle={16}`. `enabled` false (or `locked`) holds it expanded.
 */
export function useScrollCollapse({
  enabled,
  locked = false,
}: {
  enabled: boolean;
  locked?: boolean;
}) {
  const collapse = useSharedValue(0);
  const level = useAnimationLevel();
  const lastOffset = useRef(0);
  const collapsed = useRef(false);
  const changedAt = useRef(0);

  const setCollapsed = (next: boolean) => {
    if (collapsed.current === next) return;
    collapsed.current = next;
    changedAt.current = Date.now();
    collapse.set(
      withTiming(next ? 1 : 0, {
        duration: level === "off" ? 0 : level === "minimal" ? 120 : 220,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  };

  // Entering selection mode (locked) or disabling must expand right away: the list may not
  // scroll again (drag-select), so waiting for an `onScroll` would leave it folded.
  const held = !enabled || locked;
  useEffect(() => {
    if (!held || !collapsed.current) return;
    collapsed.current = false;
    changedAt.current = Date.now();
    collapse.set(
      withTiming(0, {
        duration: level === "off" ? 0 : level === "minimal" ? 120 : 220,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [held, collapse, level]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const offset = contentOffset.y;
    const maxOffset = contentSize.height - layoutMeasurement.height;
    const delta = offset - lastOffset.current;
    lastOffset.current = offset;
    if (!enabled || locked) {
      setCollapsed(false);
      return;
    }
    if (Date.now() - changedAt.current < SETTLE_MS) return;
    if (collapsed.current) {
      // Still collapsed: only a real scroll up (not the list clamping to its end) expands it.
      const clamped = offset >= maxOffset - AT_END_SLACK;
      if (clamped) return;
      if (
        delta < -DIRECTION_THRESHOLD ||
        (offset <= EXPANDED_UNTIL_OFFSET && delta < 0)
      )
        setCollapsed(false);
    } else if (
      delta > DIRECTION_THRESHOLD &&
      offset > COLLAPSE_AFTER_OFFSET &&
      maxOffset > MIN_SCROLL_TO_COLLAPSE
    )
      setCollapsed(true);
  };

  return { collapse, onScroll };
}
