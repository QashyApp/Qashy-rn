import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { EntranceScope } from "@/components/ui/motion";

/** How long a page that just became current waits before its own layout transitions resume. */
const SETTLE_DELAY = 300;

export function PagerPage({
  index,
  sign,
  baseIndex,
  width,
  translateX,
  fade,
  current,
  initial,
  paging,
  children,
}: {
  /** This page's month on the continuous month axis; never changes for a mounted page. */
  index: number;
  sign: 1 | -1;
  baseIndex: SharedValue<number>;
  width: number;
  translateX: SharedValue<number>;
  fade: SharedValue<number>;
  current: boolean;
  /** Mounted with the pager (the screen's first paint) rather than by paging. */
  initial: boolean;
  paging: boolean;
  children: ReactNode;
}) {
  // The slot offset is a transform, never `left`: every page keeps the same layout box, so
  // when a neighbour becomes the current page nothing inside it changes position. A layout
  // move there made the overview cards' layout transitions replay the slide (visibly on web).
  // It is set in a layout effect, which runs in the same commit as the pager's own
  // `translateX` reset, so the two land in one frame.
  // Layout transitions inside the page stay paused while it is a neighbour and for a moment
  // after it becomes current, so the commit re-render does not animate anything on its own.
  // Both updates are deferred; the `current` check below covers the gap. A page
  // that mounts already current by paging (a flick that outran its neighbour) starts unsettled
  // too, so it arrives drawn and still instead of playing its entrances.
  const [settled, setSettled] = useState(current && initial);
  // What entrances read at mount: only content mounting after the page settled animates.
  const entranceSettled = useRef(current && initial);
  useLayoutEffect(() => {
    entranceSettled.current = current && settled;
  });
  useEffect(() => {
    if (!current) {
      const id = requestAnimationFrame(() => setSettled(false));
      return () => cancelAnimationFrame(id);
    }
    // Settling re-renders every row of the page (their layout transitions and exits read it), so
    // it waits until swiping pauses: a run of quick swipes never pays for it between months.
    const id = setTimeout(() => setSettled(true), SETTLE_DELAY);
    return () => clearTimeout(id);
  }, [current]);
  const animated = useAnimatedStyle(() => {
    const distance = index - baseIndex.get();
    return {
      // A page more than one slot from the centre is only ever a stale frame, never a real view.
      opacity: Math.abs(distance) > 1 ? 0 : fade.get(),
      transform: [{ translateX: distance * sign * width + translateX.get() }],
    };
  });
  return (
    <Animated.View
      collapsable={false}
      // Neighbours are only ever seen mid-swipe: keep them out of touch and screen readers.
      pointerEvents={current ? "auto" : "none"}
      accessibilityElementsHidden={!current}
      importantForAccessibility={current ? "auto" : "no-hide-descendants"}
      style={[
        {
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          ...(width > 0 ? { width } : { right: 0 }),
        },
        animated,
      ]}
    >
      <EntranceScope
        suppressed={!current}
        settled={entranceSettled}
        layoutTransitions={current && settled}
        exits={current && settled && !paging}
      >
        {children}
      </EntranceScope>
    </Animated.View>
  );
}
