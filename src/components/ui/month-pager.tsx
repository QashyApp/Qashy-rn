import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  InteractionManager,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  PointerType,
  type PanGesture,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { slotDistance, useMonthSlot } from "@/components/ui/month-slot";
import { EntranceScope } from "@/components/ui/motion";
import type { MonthDirection } from "@/components/ui/month-switcher";
import {
  NO_MAX_INDEX,
  commitSpring,
  followPosition,
  monthFromIndex,
  monthIndex,
  resolveSwipe,
  swipeDisplacement,
} from "@/components/ui/resolve-swipe";
import { useLocalization } from "@/localization/localization";
import { useFinanceSettings } from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { moveMonth } from "@/utils/date";
import { hapticSelection } from "@/utils/haptics";

export { monthIndex } from "@/components/ui/resolve-swipe";

const WEB = process.env.EXPO_OS === "web";
/** Pans that start this close to a screen edge are left to the system back gesture. */
const EDGE_GUARD = 24;
const CROSSFADE_OUT = 90;
const CROSSFADE_IN = 140;
/**
 * A safety net only: if the parent never takes a requested month, the pages go back to the month
 * it does show after this long. A parent that is merely slow is reconciled when its month lands.
 */
const COMMIT_TIMEOUT = 1500;

/**
 * Style for the scroll container inside a pager page. `touch-action` only counts up to the nearest
 * scroll container, so the pager's own `pan-y` is overridden by the page's scroller (`auto`) and
 * the browser claims horizontal drags (cancelling the pointer, or navigating history). The
 * scroller has to carry `pan-y` itself for a finger swipe to reach the gesture handler.
 */
export const PAGER_SCROLLER_STYLE: ViewStyle | undefined = WEB
  ? ({ touchAction: "pan-y" } as ViewStyle)
  : undefined;

export interface MonthPagerHandle {
  /** Slide one month forward (`1`) or back (`-1`), exactly like a committed swipe. */
  goTo(direction: 1 | -1): void;
}

export interface MonthPageInfo {
  /** Only the current page should own scroll callbacks, scrolling and heavy content. */
  isCurrent: boolean;
}

type ExternalGesture = Parameters<
  PanGesture["requireExternalGestureToFail"]
>[number];

export interface MonthPagerProps {
  /** First day of the current month (`YYYY-MM-01`). */
  month: string;
  /** First day of the newest allowed month. Omit to allow any future month. */
  max?: string;
  /** Renders only the current page and ignores the gesture. */
  disabled?: boolean;
  /**
   * Called as soon as a swipe is released toward a month, while the pages are still settling, so the new month renders under the slide instead of after it. Quick swipes in
   * a row call it once per month; each call names the absolute month the pager is heading to.
   */
  onChange: (month: string, direction: MonthDirection) => void;
  renderPage: (month: string, info: MonthPageInfo) => ReactNode;
  /**
   * Gestures (for example a horizontal `Gesture.Native()` scroller inside a page) that
   * must fail before a swipe may start, so inner horizontal scrolling wins.
   */
  blockedBy?: readonly ExternalGesture[];
  /**
   * Where the pager is on the continuous month axis of {@link monthIndex}: the current month's
   * index at rest, fractional mid-swipe. Pass the same value to a `MonthSwitcher` so its title
   * slides with the pages.
   */
  position?: SharedValue<number>;
  /**
   * `false` keeps the page where it is: the swipe still tracks the finger, settles and commits
   * exactly the same, but only `position` moves, for a screen that slides just the parts
   * that change. No neighbouring pages are mounted and the page is not re-created per month.
   */
  slide?: boolean;
  style?: ViewStyle;
  ref?: Ref<MonthPagerHandle>;
}

/**
 * Routes a `MonthSwitcher` change through the pager so a tap on the previous or next
 * month slides exactly like a swipe, and anything farther (the picker) just jumps.
 */
export function navigateMonth(
  pager: MonthPagerHandle | null,
  current: string,
  next: string,
  direction: MonthDirection,
  jump: (month: string, direction: MonthDirection) => void,
) {
  if (pager && next === moveMonth(current, 1)) pager.goTo(1);
  else if (pager && next === moveMonth(current, -1)) pager.goTo(-1);
  else jump(next, direction);
}

/**
 * Previous / current / next month side by side. The drag tracks the finger 1:1, the
 * month being swiped toward slides in from its side, and release either commits
 * (a quarter of the width, or a flick), decelerating into place on a critically damped
 * spring, or springs back.
 *
 * Everything that moves is driven by one UI-thread value, `position`, on a continuous month
 * axis. Each page is keyed by its month and draws itself at `its month - position`, so a page
 * never changes place when React re-renders: the swipe commits to the parent on release and
 * the new month renders while the pages are still settling (on native, off the UI thread), the page swiped in
 * simply stays mounted as the new current page, and the next swipe can start at once, even
 * mid-slide, without waiting for that render.
 *
 * On web only touch drags swipe (mobile browsers, the installed PWA): mouse and pen are
 * inert so desktop text selection is untouched, and `touch-action: pan-y` leaves vertical
 * scrolling to the browser. Web mounts the neighbours only once a touch drag is under way and
 * drops them when the slide settles, so a plain page never holds duplicate content. Native keeps
 * them mounted. Pages are mirrored for right-to-left locales, the swipe is gated by the
 * device-local `swipeBetweenMonths` setting, and with reduced motion the slide becomes a short
 * crossfade.
 */
export function MonthPager(props: MonthPagerProps) {
  return <PagerImpl {...props} />;
}

function PagerImpl({
  month,
  max,
  disabled = false,
  onChange,
  renderPage,
  blockedBy,
  position: positionProp,
  slide = true,
  style,
  ref,
}: MonthPagerProps) {
  const settings = useFinanceSettings();
  const { isRtl } = useLocalization();
  const { background, motion } = useQashyTheme();
  const systemReduced = useReducedMotion();
  const level = useAnimationLevel();
  // The system's reduced-motion setting and the in-app Animations level (Minimal, Off) both turn the
  // slide into a crossfade; Off makes it instant.
  const reduced = systemReduced || level !== "all";
  const fadeScale = level === "off" ? 0 : 1;
  const spring = motion.spring.snappy;
  const committing = useMemo(() => commitSpring(spring), [spring]);

  const [width, setWidth] = useState(0);
  // Native: the neighbours are mounted once interactions first settle (or on the first touch),
  // and from then on stay mounted; a commit only mounts the one new far neighbour.
  const [warm, setWarm] = useState(false);
  // Web: the month a touch drag started around, while its pages are mounted.
  const [engagedFor, setEngagedFor] = useState<string | null>(null);
  // Pages mounted with the pager share the screen's first paint; any page mounted later (a
  // neighbour, or the new month after a jump) must arrive without replaying entrances.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBooted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // A page that is replaced as a whole (a month change with no neighbour to slide in) must not
  // leave its exit fades behind as ghosts over the next month.
  const [paging, setPaging] = useState(false);

  const ownPosition = useSharedValue(monthIndex(month));
  const position = positionProp ?? ownPosition;
  // The month the pager rests on or is settling into. Swipes are judged against it, and it is
  // ahead of `month` between a release and the parent's render.
  const target = useSharedValue(monthIndex(month));
  const fade = useSharedValue(1);
  const startPosition = useSharedValue(0);
  // This gesture moves the pages (it was not started during a crossfade).
  const tracking = useSharedValue(false);
  // A committed slide is in flight, and whether this gesture caught one.
  const sliding = useSharedValue(false);
  const caughtSlide = useSharedValue(false);
  // Only the reduced-motion crossfade blocks input, for its ~90ms fade-out.
  const busy = useSharedValue(false);
  const warmed = useSharedValue(false);
  // Web touch gating: where the touch landed, and whether it is a finger at all.
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchOk = useSharedValue(false);

  const maxIndex = max != null ? monthIndex(max) : NO_MAX_INDEX;
  const pagesEnabled = !disabled && width > 0;
  const swipeEnabled = pagesEnabled && Boolean(settings.swipeBetweenMonths);

  // Latest props for callbacks that outlive a render (animation completions).
  const monthRef = useRef(month);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    monthRef.current = month;
    onChangeRef.current = onChange;
  });

  // Months this pager asked the parent for and has not seen arrive yet, newest last.
  const requested = useRef<number[]>([]);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(commitTimer.current), []);
  // Web: a settled slide whose pages are dropped once the parent shows its month.
  const pendingRelease = useRef<number | null>(null);

  // Put the pages on `index` at once: the parent changed month by itself (the picker, a link,
  // a declined or overtaken request).
  const placeAt = useCallback(
    (index: number) => {
      runOnUI(() => {
        "worklet";
        cancelAnimation(position);
        target.set(index);
        position.set(index);
        sliding.set(false);
      })();
    },
    [position, target, sliding],
  );

  useLayoutEffect(() => {
    const index = monthIndex(month);
    const queue = requested.current;
    const at = queue.indexOf(index);
    if (at >= 0) {
      // A month this pager asked for: the pages are already there or on their way. An earlier
      // request landing late (quick swipes in a row) changes nothing either.
      if (at === queue.length - 1) {
        requested.current = [];
        clearTimeout(commitTimer.current);
      } else {
        requested.current = queue.slice(at + 1);
      }
    } else {
      requested.current = [];
      clearTimeout(commitTimer.current);
      placeAt(index);
    }
    if (WEB && pendingRelease.current === index) {
      pendingRelease.current = null;
      setEngagedFor(null);
    }
  }, [month, placeAt]);

  // Two frames after a month change the replaced page is gone; exits may play again.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPaging(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [month]);

  // Native: mount the neighbours once interactions settle, or on the first touch if sooner.
  useEffect(() => {
    if (WEB || warm || width <= 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      setWarm(true);
    });
    return () => handle.cancel();
  }, [warm, width]);
  const warmUp = useCallback(() => setWarm(true), []);
  const engage = useCallback((index: number) => {
    pendingRelease.current = null;
    setEngagedFor(monthFromIndex(index));
  }, []);
  // Web: drop the neighbours once a slide has settled on `index` and the parent shows it.
  const release = useCallback((index: number) => {
    if (monthIndex(monthRef.current) === index) setEngagedFor(null);
    else pendingRelease.current = index;
  }, []);

  const commit = useCallback(
    (from: number, to: number, haptic: boolean) => {
      if (haptic) hapticSelection();
      requested.current = [...requested.current, to];
      // The new month renders while the pages settle. Not in a transition: a parent that also
      // writes route params (Transactions) would see the params land urgently ahead of its own
      // month state, and bounce back to the old month for a render.
      onChangeRef.current(monthFromIndex(to), to > from ? "right" : "left");
      clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        if (!requested.current.length) return;
        requested.current = [];
        placeAt(monthIndex(monthRef.current));
      }, COMMIT_TIMEOUT);
    },
    [placeAt],
  );

  /** Settles on month `next` (the current target, or one either side of it). */
  const settle = (next: number, velocityX: number, haptic: boolean) => {
    "worklet";
    const from = target.get();
    if (next !== from) {
      target.set(next);
      runOnJS(commit)(from, next, haptic);
    }
    if (reduced) {
      if (next === from && position.get() === next) return;
      busy.set(true);
      fade.set(
        withTiming(0, { duration: CROSSFADE_OUT * fadeScale }, () => {
          // Faded out: jump to wherever the pager is now heading, and fade back in.
          position.set(target.get());
          busy.set(false);
          fade.set(withTiming(1, { duration: CROSSFADE_IN * fadeScale }));
          if (WEB) runOnJS(release)(target.get());
        }),
      );
      return;
    }
    sliding.set(next !== from);
    const pageVelocity =
      width > 0 && next !== from ? (-velocityX * (isRtl ? -1 : 1)) / width : 0;
    position.set(
      withSpring(
        next,
        {
          ...(next !== from ? committing : spring),
          velocity: pageVelocity,
          overshootClamping: true,
          // Done once it is within about half a pixel. The default runs on for a couple of
          // hundred milliseconds of motion too small to see.
          energyThreshold:
            width > 0 ? Math.max(1e-7, (0.5 / width) ** 2) : 1e-6,
        },
        (finished) => {
          if (!finished) return;
          sliding.set(false);
          if (WEB) runOnJS(release)(next);
        },
      ),
    );
  };

  const gesture = useMemo(() => {
    const base = Gesture.Pan()
      .enabled(swipeEnabled)
      .hitSlop({ left: -EDGE_GUARD, right: -EDGE_GUARD });
    const activating = WEB
      ? // Manual activation so only a finger can start a swipe: the pointer type is checked on
        // touch-down, then the same 24px horizontal / 14px vertical thresholds apply.
        base
          .manualActivation(true)
          .onTouchesDown((event, manager) => {
            const touch = event.allTouches[0];
            if (event.pointerType !== PointerType.TOUCH || !touch) {
              touchOk.set(false);
              manager.fail();
              return;
            }
            touchOk.set(true);
            touchX.set(touch.absoluteX);
            touchY.set(touch.absoluteY);
          })
          // `engage` only runs once a finger starts a swipe, never in render.
          // eslint-disable-next-line react-hooks/refs
          .onTouchesMove((event, manager) => {
            const touch = event.allTouches[0];
            if (!touchOk.get() || !touch) return;
            const dx = touch.absoluteX - touchX.get();
            const dy = touch.absoluteY - touchY.get();
            if (Math.abs(dy) > 14) {
              touchOk.set(false);
              manager.fail();
            } else if (Math.abs(dx) >= 24) {
              touchOk.set(false);
              if (slide) runOnJS(engage)(target.get());
              manager.activate();
            }
          })
      : base
          .activeOffsetX([-24, 24])
          .failOffsetY([-14, 14])
          // Only the very first touch reaches JS (to mount the neighbours early); later touches,
          // vertical scrolls included, never cost a render.
          .onBegin(() => {
            if (!slide || warmed.get()) return;
            warmed.set(true);
            runOnJS(warmUp)();
          });
    const pan = activating
      .onStart(() => {
        tracking.set(!busy.get());
        if (!tracking.get()) return;
        caughtSlide.set(sliding.get());
        sliding.set(false);
        cancelAnimation(position);
        startPosition.set(position.get());
      })
      .onUpdate((event) => {
        if (!tracking.get() || reduced) return;
        position.set(
          followPosition(
            startPosition.get(),
            event.translationX,
            width,
            isRtl,
            target.get(),
            maxIndex,
          ),
        );
      })
      // `commit` and `release` read refs on the JS thread after a release, never in render.
      // eslint-disable-next-line react-hooks/refs
      .onEnd((event) => {
        if (!tracking.get()) return;
        tracking.set(false);
        const anchor = target.get();
        const direction = resolveSwipe(
          swipeDisplacement(
            (anchor - position.get()) * (isRtl ? -1 : 1) * width,
            event.translationX,
            // With reduced motion the pages never followed the finger: only its travel counts.
            caughtSlide.get() || reduced,
          ),
          event.velocityX,
          width,
          anchor + 1 <= maxIndex,
          isRtl,
        );
        settle(anchor + direction, event.velocityX, true);
      });
    return blockedBy?.length
      ? pan.requireExternalGestureToFail(...blockedBy)
      : pan;
    // `settle` closes over exactly the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    swipeEnabled,
    slide,
    width,
    maxIndex,
    isRtl,
    reduced,
    fadeScale,
    spring,
    committing,
    blockedBy,
    engage,
    warmUp,
    release,
    commit,
  ]);

  // The pages on screen: the current month, plus its neighbours once they are wanted.
  const around =
    !slide || !pagesEnabled ? null : WEB ? engagedFor : warm ? month : null;
  const months = useMemo(() => {
    const list = [month];
    if (around) {
      for (const candidate of [
        moveMonth(around, -1),
        around,
        moveMonth(around, 1),
      ]) {
        if (max != null && candidate > max) continue;
        if (!list.includes(candidate)) list.push(candidate);
      }
    }
    return list.sort();
  }, [month, around, max]);

  useImperativeHandle(
    ref,
    () => ({
      goTo: (direction) => {
        if (busy.get()) return;
        const from = target.get();
        const to = from + direction;
        if (to > maxIndex) return;
        // Without the page to slide in (web outside a drag, disabled, not laid out yet), the
        // month just changes.
        const canSlide =
          pagesEnabled && (!slide || months.includes(monthFromIndex(to)));
        if (!canSlide) {
          setPaging(true);
          onChangeRef.current(
            monthFromIndex(to),
            direction > 0 ? "right" : "left",
          );
          return;
        }
        runOnUI(settle)(to, 0, false);
      },
    }),
    // `settle` closes over exactly the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      maxIndex,
      pagesEnabled,
      slide,
      months,
      reduced,
      fadeScale,
      width,
      isRtl,
      spring,
      committing,
      commit,
      release,
    ],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (current === next ? current : next));
  };

  return (
    <GestureDetector
      gesture={gesture}
      // Web only: keep vertical scrolling with the browser, leave text selectable.
      touchAction="pan-y"
      userSelect="auto"
    >
      <View
        collapsable={false}
        onLayout={onLayout}
        style={[
          { flex: 1, overflow: "hidden", backgroundColor: background },
          style,
        ]}
      >
        {!slide ? (
          <View style={{ flex: 1 }}>
            {renderPage(month, { isCurrent: true })}
          </View>
        ) : (
          months.map((pageMonth) => (
            <PagerPage
              key={pageMonth}
              index={monthIndex(pageMonth)}
              isRtl={isRtl}
              position={position}
              width={width}
              fade={fade}
              current={pageMonth === month}
              initial={!booted}
              paging={paging}
            >
              {renderPage(pageMonth, { isCurrent: pageMonth === month })}
            </PagerPage>
          ))
        )}
      </View>
    </GestureDetector>
  );
}

function PagerPage({
  index,
  isRtl,
  position,
  width,
  fade,
  current,
  initial,
  paging,
  children,
}: {
  /** This page's month on the continuous month axis; never changes for a mounted page. */
  index: number;
  isRtl: boolean;
  position: SharedValue<number>;
  width: number;
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
  // Layout transitions inside the page stay paused while it is a neighbour and for two frames
  // after it becomes current, so the commit re-render does not animate anything on its own.
  // Both updates are deferred to a frame; the `current` check below covers the gap. A page
  // that mounts already current by paging (a jump) starts unsettled too, so it arrives drawn
  // and still instead of playing its entrances.
  const [settled, setSettled] = useState(current && initial);
  // What entrances read at mount: only content mounting after the page settled animates.
  const entranceSettled = useRef(current && initial);
  useLayoutEffect(() => {
    entranceSettled.current = current && settled;
  });
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      if (!current) {
        setSettled(false);
        return;
      }
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [current]);
  const pinned = useMonthSlot(index, position, current);
  const sign = isRtl ? -1 : 1;
  const animated = useAnimatedStyle(() => {
    const distance = slotDistance(index, position, pinned);
    return {
      // A page more than one slot from the centre is only ever a stale frame, never a real view.
      opacity: Math.abs(distance) > 1 ? 0 : fade.get(),
      transform: [{ translateX: distance * sign * width }],
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
