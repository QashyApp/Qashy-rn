import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  ReduceMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { motionCurves } from "@/components/ui/motion";
import {
  accumulateTravel,
  travelDirection,
} from "@/components/ui/scroll-direction";

const EXPANDED_UNTIL_OFFSET = 32;
const COLLAPSE_AFTER_OFFSET = 96;
/**
 * Collapsing resizes the list under the finger, which can itself move the scroll offset (a short
 * list clamps). Scroll events while the animation runs, and a frame or two after, are the resize
 * talking, not the user.
 */
const SETTLE_SLACK_MS = 32;
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
 * `scrollEventThrottle={16}`. `enabled` false (or `locked`) holds it expanded; `forceCollapsed`
 * holds it collapsed (selection mode wants the room) and wins over `locked`.
 */
export function useScrollCollapse({
  enabled,
  locked = false,
  forceCollapsed = false,
}: {
  enabled: boolean;
  locked?: boolean;
  forceCollapsed?: boolean;
}) {
  const collapse = useSharedValue(0);
  const level = useAnimationLevel();
  const lastOffset = useRef(0);
  const collapsed = useRef(false);
  const travel = useRef(0);
  const changedAt = useRef(0);
  const settleMs = useRef(0);

  const forced = enabled && forceCollapsed;
  const held = !enabled || (locked && !forced);
  // `onScroll` reads what changes between renders from here, so it can stay the same function for
  // the screen's whole life (memoised pages depend on that).
  const latest = useRef({ forced, held, level });
  useEffect(() => {
    latest.current = { forced, held, level };
  }, [forced, held, level]);

  const animateTo = useCallback(
    (next: boolean) => {
      const duration =
        latest.current.level === "off"
          ? 0
          : latest.current.level === "minimal"
            ? 120
            : 220;
      collapsed.current = next;
      changedAt.current = Date.now();
      settleMs.current = duration + SETTLE_SLACK_MS;
      // The direction that led here is spent; the next flip is a fresh run.
      travel.current = 0;
      collapse.set(
        withTiming(next ? 1 : 0, {
          duration,
          easing: motionCurves.standard,
          reduceMotion: ReduceMotion.System,
        }),
      );
    },
    [collapse],
  );
  const setCollapsed = useCallback(
    (next: boolean) => {
      if (collapsed.current !== next) animateTo(next);
    },
    [animateTo],
  );

  // Being held open or forced shut takes effect right away, not on the next scroll: the list may
  // not scroll at all meanwhile (drag-select), or be too short to. When a forced collapse ends
  // near the top of the list, open again, since there is no scroll up left to do it.
  useEffect(() => {
    if (forced) {
      if (!collapsed.current) animateTo(true);
    } else if (
      collapsed.current &&
      (held || lastOffset.current <= COLLAPSE_AFTER_OFFSET)
    ) {
      animateTo(false);
    }
  }, [forced, held, animateTo]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const state = latest.current;
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const offset = contentOffset.y;
      const maxOffset = contentSize.height - layoutMeasurement.height;
      const delta = offset - lastOffset.current;
      lastOffset.current = offset;
      if (state.forced) return;
      if (state.held) {
        setCollapsed(false);
        return;
      }
      if (Date.now() - changedAt.current < settleMs.current) return;
      travel.current = accumulateTravel(travel.current, delta);
      const direction = travelDirection(travel.current);
      if (collapsed.current) {
        // Still collapsed: only a real scroll up (not the list clamping to its end) expands it.
        const clamped = offset >= maxOffset - AT_END_SLACK;
        if (clamped) return;
        if (direction < 0 || (offset <= EXPANDED_UNTIL_OFFSET && delta < 0))
          setCollapsed(false);
      } else if (
        direction > 0 &&
        offset > COLLAPSE_AFTER_OFFSET &&
        maxOffset > MIN_SCROLL_TO_COLLAPSE
      )
        setCollapsed(true);
    },
    [setCollapsed],
  );

  return { collapse, onScroll };
}
