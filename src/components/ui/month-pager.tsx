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
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { EntranceScope } from "@/components/ui/motion";
import type { MonthDirection } from "@/components/ui/month-switcher";
import { commitSpring, resolveSwipe } from "@/components/ui/resolve-swipe";
import { useLocalization } from "@/localization/localization";
import { useFinanceSettings } from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { moveMonth } from "@/utils/date";
import { hapticSelection } from "@/utils/haptics";

const WEB = process.env.EXPO_OS === "web";
/** Pans that start this close to a screen edge are left to the system back gesture. */
const EDGE_GUARD = 24;
/** Past the newest allowed month the pages barely follow the finger. */
const BLOCKED_FOLLOW = 0.12;
const CROSSFADE_OUT = 90;
const CROSSFADE_IN = 140;
/** If the parent ignores `onChange`, put the pages back after this long. */
const COMMIT_TIMEOUT = 400;

/**
 * Style for the scroll container inside a pager page. `touch-action` only counts up to the nearest
 * scroll container, so the pager's own `pan-y` is overridden by the page's scroller (`auto`) and
 * the browser claims horizontal drags (cancelling the pointer, or navigating history). The
 * scroller has to carry `pan-y` itself for a finger swipe to reach the gesture handler.
 */
export const PAGER_SCROLLER_STYLE: ViewStyle | undefined = WEB
  ? ({ touchAction: "pan-y" } as ViewStyle)
  : undefined;

/** A month's position on a continuous axis, so neighbouring months are exactly one apart. */
function monthIndex(month: string) {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
}

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
  onChange: (month: string, direction: MonthDirection) => void;
  renderPage: (month: string, info: MonthPageInfo) => ReactNode;
  /**
   * Gestures (for example a horizontal `Gesture.Native()` scroller inside a page) that
   * must fail before a swipe may start, so inner horizontal scrolling wins.
   */
  blockedBy?: readonly ExternalGesture[];
  /**
   * Written with the drag in page widths (0 at rest, -1 once the next month has slid fully in), so
   * a control outside the pager, such as the month title, can move with the same gesture.
   */
  dragProgress?: SharedValue<number>;
  /**
   * `false` keeps the page where it is: the swipe still tracks the finger, settles and commits
   * exactly the same, but only `dragProgress` moves, for a screen that slides just the parts
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
 * On web only touch drags swipe (mobile browsers, the installed PWA): mouse and pen are
 * inert so desktop text selection is untouched, and `touch-action: pan-y` leaves vertical
 * scrolling to the browser. Web mounts the neighbours only once a touch drag is under way,
 * so a plain page never holds duplicate content. Pages are mirrored for right-to-left locales, the swipe is
 * gated by the device-local `swipeBetweenMonths` setting, and with reduced motion the
 * slide becomes a short crossfade.
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
  dragProgress,
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
  // A committed slide is stiffer than the theme's own spring: the next swipe cannot start until it
  // lands, so every millisecond of settling is a millisecond of apparent lag.
  const committing = useMemo(
    () => commitSpring({ ...spring, stiffness: spring.stiffness * 1.6 }),
    [spring],
  );

  const [width, setWidth] = useState(0);
  // The month the neighbours were last mounted for; stale means "not yet".
  const [readyFor, setReadyFor] = useState<string | null>(null);
  // Native: once warm the neighbours stay mounted across month changes (pages are keyed by month,
  // so a commit only mounts the one new far page). Dropping them on every change left the next
  // swipe sliding over blank space until they came back.
  const [warm, setWarm] = useState(false);
  // Pages mounted with the pager share the screen's first paint; any page mounted later (a
  // neighbour, or the new month after a flick outran its neighbour) must arrive without
  // replaying entrances.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBooted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // True from the moment a swipe (or a slide from the month switcher) starts until the new
  // month has settled. Exit fades are off meanwhile: the page being paged away is removed as a
  // whole, and its exits would otherwise linger as ghosts over the next month.
  const [paging, setPaging] = useState(false);

  const translateX = useSharedValue(0);
  // The month index sitting at the centre. Pages place themselves from their own (fixed) index
  // against this, so the commit swaps the centre and zeroes the drag in one UI-thread step instead
  // of re-slotting every page in a separate update that could land a frame apart.
  const baseIndex = useSharedValue(monthIndex(month));
  const fade = useSharedValue(1);
  const startX = useSharedValue(0);
  const busy = useSharedValue(false);
  // This gesture moves the pages. A touch that lands while a commit is in flight never does, even
  // if the commit finishes mid-touch: it would otherwise start following the finger from a stale
  // offset with no neighbour beside it.
  const tracking = useSharedValue(false);
  // Native: only the very first touch needs to reach JS (to mount the neighbours early).
  const warmed = useSharedValue(false);
  // Web touch gating: where the touch landed, and whether it is a finger at all.
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchOk = useSharedValue(false);

  useAnimatedReaction(
    () => (width > 0 ? translateX.get() / width : 0),
    (progress) => {
      if (dragProgress) dragProgress.set(progress);
    },
    [width, dragProgress],
  );

  const prevMonth = useMemo(() => moveMonth(month, -1), [month]);
  const nextMonth = useMemo(() => moveMonth(month, 1), [month]);
  const canForward = !(max != null && nextMonth > max);
  const pagesEnabled = !disabled && width > 0;
  const swipeEnabled = pagesEnabled && Boolean(settings.swipeBetweenMonths);
  const neighbours = slide && pagesEnabled && (WEB ? readyFor === month : warm);
  const sign = isRtl ? -1 : 1;

  // Latest props for callbacks that outlive a render (animation completions).
  const monthRef = useRef(month);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    monthRef.current = month;
    onChangeRef.current = onChange;
  });

  // Mount the neighbours once interactions settle, or on the first touch if that is sooner.
  useEffect(() => {
    if (WEB || width <= 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      setWarm(true);
    });
    return () => handle.cancel();
  }, [month, width]);
  const markReady = useCallback(() => {
    setPaging(true);
    setWarm(true);
    setReadyFor(monthRef.current);
  }, []);
  const beginPaging = useCallback(() => setPaging(true), []);
  const endPaging = useCallback(() => setPaging(false), []);
  // Two frames after the swap, like the pages themselves: the old page is gone by then.
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
  const clearReady = useCallback(() => setReadyFor(null), []);

  // The swap and the reset land in the same commit: the pages have just been re-keyed
  // for the new month, so the slide offset goes back to zero before the next frame.
  useLayoutEffect(() => {
    const index = monthIndex(month);
    runOnUI(() => {
      "worklet";
      baseIndex.set(index);
      translateX.set(0);
      // The title follows `translateX` a frame late; reset it with the pages so the new month's
      // name never lands for a frame at the old offset.
      dragProgress?.set(0);
      busy.set(false);
      if (reduced)
        fade.set(withTiming(1, { duration: CROSSFADE_IN * fadeScale }));
      else fade.set(1);
    })();
  }, [
    month,
    reduced,
    fadeScale,
    baseIndex,
    translateX,
    dragProgress,
    busy,
    fade,
  ]);

  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(commitTimer.current), []);
  const commit = useCallback(
    (direction: 1 | -1, haptic: boolean) => {
      if (haptic) hapticSelection();
      const from = monthRef.current;
      onChangeRef.current(
        moveMonth(from, direction),
        direction > 0 ? "right" : "left",
      );
      // A parent that declines the change must not leave the pages stranded off-screen.
      clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        if (monthRef.current !== from) return;
        translateX.set(0);
        fade.set(1);
        busy.set(false);
        setPaging(false);
      }, COMMIT_TIMEOUT);
    },
    [translateX, fade, busy],
  );

  const settle = (direction: -1 | 0 | 1, velocity: number, haptic: boolean) => {
    "worklet";
    if (direction === 0) {
      translateX.set(
        withSpring(
          0,
          { ...spring, velocity, overshootClamping: true },
          (finished) => {
            // Web mounts neighbours per drag; unmount them once the pages are back.
            if (WEB && finished) runOnJS(clearReady)();
          },
        ),
      );
      return;
    }
    busy.set(true);
    if (reduced) {
      fade.set(
        withTiming(0, { duration: CROSSFADE_OUT * fadeScale }, (finished) => {
          if (finished) runOnJS(commit)(direction, haptic);
          else busy.set(false);
        }),
      );
      return;
    }
    translateX.set(
      withSpring(
        -direction * sign * width,
        {
          ...committing,
          velocity,
          overshootClamping: true,
          // Done once within about half a pixel. The default keeps running for ~250ms of motion
          // too small to see, and the month (and the next swipe) waits for it.
          energyThreshold:
            width > 0 ? Math.max(1e-7, (0.5 / width) ** 2) : 1e-6,
        },
        (finished) => {
          if (finished) runOnJS(commit)(direction, haptic);
          else busy.set(false);
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
          // `markReady` reads a ref only when a finger starts a swipe, never in render.
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
              runOnJS(markReady)();
              manager.activate();
            }
          })
      : base
          .activeOffsetX([-24, 24])
          .failOffsetY([-14, 14])
          // `markReady` reads a ref only when the touch lands, never in render.
          // eslint-disable-next-line react-hooks/refs
          .onBegin(() => {
            if (warmed.get()) return;
            warmed.set(true);
            runOnJS(markReady)();
          });
    const pan = activating
      .onStart(() => {
        // A swipe already committing owns the pages: grabbing them mid-slide restarted the drag
        // from a half-way offset and read as a second swipe.
        tracking.set(!busy.get());
        if (!tracking.get()) return;
        // Native: a swipe has begun (web already said so on activation).
        if (!WEB) runOnJS(beginPaging)();
        cancelAnimation(translateX);
        startX.set(translateX.get());
      })
      .onUpdate((event) => {
        if (!tracking.get() || reduced) return;
        const raw = startX.get() + event.translationX;
        const towardForward = raw * sign < 0;
        const followed =
          towardForward && !canForward ? raw * BLOCKED_FOLLOW : raw;
        translateX.set(Math.max(-width, Math.min(width, followed)));
      })
      // The refs behind `commit` are only read when an animation finishes, never in render.
      // eslint-disable-next-line react-hooks/refs
      .onEnd((event) => {
        if (!tracking.get()) return;
        tracking.set(false);
        const direction = resolveSwipe(
          // The whole offset, not just this touch: a spring-back caught mid-way keeps its start.
          startX.get() + event.translationX,
          event.velocityX,
          width,
          canForward,
          isRtl,
        );
        settle(direction, direction === 0 ? 0 : event.velocityX, true);
      })
      // A touch that never became a committed swipe (a tap, a scroll, a spring-back).
      .onFinalize(() => {
        if (!busy.get()) runOnJS(endPaging)();
      });
    return blockedBy?.length
      ? pan.requireExternalGestureToFail(...blockedBy)
      : pan;
    // `settle` closes over exactly the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    swipeEnabled,
    width,
    canForward,
    isRtl,
    sign,
    reduced,
    fadeScale,
    spring,
    committing,
    blockedBy,
    markReady,
    beginPaging,
    warmed,
    clearReady,
    endPaging,
    commit,
    touchX,
    touchY,
    touchOk,
    translateX,
    startX,
    busy,
    tracking,
    fade,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      goTo: (direction) => {
        if (direction > 0 && !canForward) return;
        if (busy.get()) return;
        setPaging(true);
        if (!neighbours || disabled) {
          commit(direction, false);
          return;
        }
        settle(direction, 0, false);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      canForward,
      neighbours,
      disabled,
      reduced,
      fadeScale,
      width,
      sign,
      spring,
      committing,
      commit,
      busy,
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
        ) : null}
        {neighbours ? (
          <PagerPage
            key={prevMonth}
            index={monthIndex(prevMonth)}
            sign={sign}
            baseIndex={baseIndex}
            width={width}
            translateX={translateX}
            fade={fade}
            current={false}
            initial={!booted}
            paging={paging}
          >
            {renderPage(prevMonth, { isCurrent: false })}
          </PagerPage>
        ) : null}
        {slide ? (
          <PagerPage
            key={month}
            index={monthIndex(month)}
            sign={sign}
            baseIndex={baseIndex}
            width={width}
            translateX={translateX}
            fade={fade}
            current
            initial={!booted}
            paging={paging}
          >
            {renderPage(month, { isCurrent: true })}
          </PagerPage>
        ) : null}
        {neighbours && canForward ? (
          <PagerPage
            key={nextMonth}
            index={monthIndex(nextMonth)}
            sign={sign}
            baseIndex={baseIndex}
            width={width}
            translateX={translateX}
            fade={fade}
            current={false}
            initial={!booted}
            paging={paging}
          >
            {renderPage(nextMonth, { isCurrent: false })}
          </PagerPage>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function PagerPage({
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
  // Layout transitions inside the page stay paused while it is a neighbour and for two frames
  // after it becomes current, so the commit re-render does not animate anything on its own.
  // Both updates are deferred to a frame; the `current` check below covers the gap. A page
  // that mounts already current by paging (a flick that outran its neighbour) starts unsettled
  // too, so it arrives drawn and still instead of playing its entrances.
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
