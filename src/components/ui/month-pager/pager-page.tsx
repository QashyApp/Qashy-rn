import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { EntranceScope } from "@/components/ui/motion";
import {
  PageSlideContext,
  type PageSlide,
} from "@/components/ui/month-pager/slide-context";
import {
  FOLLOW_IDLE_MS,
  deckLook,
  maxLag,
  type FollowSpec,
} from "@/components/ui/month-pager/slide-style";
import type { MonthSlideStyle } from "@/domain/models";
import { useQashyTheme } from "@/theme/theme";

/** How long a page that just became current waits before its own layout transitions resume. */
const SETTLE_DELAY = 300;

/** A soft shadow on the edge of the deck page that slides over the others (px, blur). */
const DECK_SHADOW_OFFSET = 8;
const DECK_SHADOW_BLUR = 24;

/**
 * Gives a cascade page's items what they follow: the page's continuous offset (the sum the page is
 * drawn at) and a clock. The clock runs (as a looping animation, so the UI thread has a frame to
 * integrate on) from the page's first move until it has been still for `FOLLOW_IDLE_MS`, then
 * stops, and every item snaps to exactly its page: nothing ticks while the pager is at rest.
 */
function CascadeScope({
  index,
  sign,
  baseIndex,
  width,
  translateX,
  follow,
  children,
}: {
  index: number;
  sign: 1 | -1;
  baseIndex: SharedValue<number>;
  width: number;
  translateX: SharedValue<number>;
  follow: FollowSpec;
  children: ReactNode;
}) {
  const offset = useDerivedValue(
    () => (index - baseIndex.get()) * sign * width + translateX.get(),
  );
  const clock = useSharedValue(0);
  const running = useSharedValue(false);
  const moved = useSharedValue(0);
  useAnimatedReaction(
    () => offset.get(),
    (_now, previous) => {
      if (previous === null) return;
      moved.set(performance.now());
      if (running.get()) return;
      running.set(true);
      clock.set(
        withRepeat(
          withTiming(clock.get() + 1, {
            duration: 1000,
            easing: Easing.linear,
          }),
          -1,
          false,
        ),
      );
    },
  );
  useAnimatedReaction(
    () => (running.get() ? clock.get() : -1),
    (tick) => {
      if (tick < 0) return;
      if (performance.now() - moved.get() < FOLLOW_IDLE_MS) return;
      cancelAnimation(clock);
      running.set(false);
    },
  );
  const lag = maxLag(width);
  const slide = useMemo<PageSlide>(
    () => ({
      style: "cascade",
      cascade: { offset, clock, running, base: follow, lag },
    }),
    [offset, clock, running, follow, lag],
  );
  return (
    <PageSlideContext.Provider value={slide}>
      {children}
    </PageSlideContext.Provider>
  );
}

/**
 * Dims the page under the deck's top page: an overlay in the background colour, which reads as the
 * page's own opacity falling without making the page a group layer (a layer would be re-rendered
 * with its charts each frame).
 */
function DeckDim({
  index,
  sign,
  baseIndex,
  width,
  translateX,
  color,
}: {
  index: number;
  sign: 1 | -1;
  baseIndex: SharedValue<number>;
  width: number;
  translateX: SharedValue<number>;
  color: string;
}) {
  const animated = useAnimatedStyle(() => {
    const progress = width > 0 ? (translateX.get() * sign) / width : 0;
    return { opacity: deckLook(index - baseIndex.get() + progress).dim };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color }, animated]}
    />
  );
}

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
  slideStyle,
  follow,
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
  /** How the page moves (`calm` unless content may travel); see `resolveSlideStyle`. */
  slideStyle: MonthSlideStyle;
  /** The top item's follow spring, for the cascade style. */
  follow: FollowSpec;
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
  const { background } = useQashyTheme();
  const deck = slideStyle === "deck";
  const cascading = slideStyle === "cascade";
  const plain = useMemo<PageSlide>(
    () => ({ style: slideStyle, cascade: null }),
    [slideStyle],
  );
  const animated = useAnimatedStyle(() => {
    const distance = index - baseIndex.get();
    // A page more than one slot from the centre is only ever a stale frame, never a real view.
    const hidden = Math.abs(distance) > 1;
    if (deck) {
      // Pages stack in month order, later on top, and move by their position among the months
      // alone: re-basing at a landing changes nothing, and neither does the direction of travel.
      const progress = width > 0 ? (translateX.get() * sign) / width : 0;
      const look = deckLook(distance + progress);
      return {
        // Fully covered is as good as gone, and costs nothing to draw.
        opacity: hidden || look.covered >= 1 ? 0 : fade.get(),
        zIndex: Math.max(0, Math.min(2, distance + 1)),
        transform: [
          { translateX: look.lead * sign * width },
          { scale: look.scale },
        ],
      };
    }
    return {
      opacity: hidden ? 0 : fade.get(),
      transform: [{ translateX: distance * sign * width + translateX.get() }],
    };
  });
  const content = (
    <EntranceScope
      suppressed={!current}
      settled={entranceSettled}
      layoutTransitions={current && settled}
      exits={current && settled && !paging}
    >
      {children}
    </EntranceScope>
  );
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
        // The deck's top page is opaque, so the page under it never shows through, and throws a
        // soft shadow from its leading edge onto it.
        deck
          ? {
              backgroundColor: background,
              boxShadow: `${-sign * DECK_SHADOW_OFFSET}px 0px ${DECK_SHADOW_BLUR}px 0px rgba(0, 0, 0, 0.18)`,
            }
          : null,
        animated,
      ]}
    >
      {cascading ? (
        <CascadeScope
          index={index}
          sign={sign}
          baseIndex={baseIndex}
          width={width}
          translateX={translateX}
          follow={follow}
        >
          {content}
        </CascadeScope>
      ) : (
        <PageSlideContext.Provider value={plain}>
          {content}
        </PageSlideContext.Provider>
      )}
      {deck ? (
        <DeckDim
          index={index}
          sign={sign}
          baseIndex={baseIndex}
          width={width}
          translateX={translateX}
          color={String(background)}
        />
      ) : null}
    </Animated.View>
  );
}
