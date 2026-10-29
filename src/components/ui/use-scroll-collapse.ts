import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
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
 *
 * `expand` opens it at once and forgets the scroll so far, for a change of list (another month's
 * page): the next scroll event re-syncs from the new list's offset.
 *
 * Durations come from the theme (folding is an exit, so it is the faster of the two); at the
 * minimal level they are quick fades and at `off` the value jumps. What the value drives is up to
 * the consumer: see `Collapsible`, which snaps its layout when content may not travel.
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
  const { instant } = useMotionPreference();
  const durations = useMotionDurations();
  const lastOffset = useRef(0);
  const collapsed = useRef(false);
  const travel = useRef(0);
  const changedAt = useRef(0);
  const settleMs = useRef(0);
  // Set by `expand`: the next scroll event belongs to a different list, so it only re-bases the offset.
  const rebase = useRef(false);

  const forced = enabled && forceCollapsed;
  const held = !enabled || (locked && !forced);
  // `onScroll` reads what changes between renders from here, so it can stay the same function for
  // the screen's whole life (memoised pages depend on that).
  const latest = useRef({ forced, held, instant, durations });
  useEffect(() => {
    latest.current = { forced, held, instant, durations };
  }, [forced, held, instant, durations]);

  const animateTo = useCallback(
    (next: boolean) => {
      const { instant, durations } = latest.current;
      const duration = instant ? 0 : next ? durations.exit : durations.enter;
      collapsed.current = next;
      changedAt.current = Date.now();
      settleMs.current = duration + SETTLE_SLACK_MS;
      // The direction that led here is spent; the next flip is a fresh run.
      travel.current = 0;
      collapse.set(
        withTiming(next ? 1 : 0, {
          duration,
          easing: next ? motionCurves.exit : motionCurves.standard,
          reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
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
      const delta = rebase.current ? 0 : offset - lastOffset.current;
      rebase.current = false;
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

  const expand = useCallback(() => {
    travel.current = 0;
    rebase.current = true;
    // Forced shut (selecting) stays shut: that is not the list's scroll talking.
    if (!latest.current.forced) setCollapsed(false);
  }, [setCollapsed]);

  return { collapse, onScroll, expand };
}
