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
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { EntranceScope } from "@/components/ui/motion";
import type { MonthDirection } from "@/components/ui/month-switcher";
import { resolveSwipe } from "@/components/ui/resolve-swipe";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
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
 * (a quarter of the width, or a flick) or springs back.
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
  style,
  ref,
}: MonthPagerProps) {
  const { settings } = useFinanceState();
  const { isRtl } = useLocalization();
  const { background, motion } = useQashyTheme();
  const reduced = useReducedMotion();
  const spring = motion.spring.snappy;

  const [width, setWidth] = useState(0);
  // The month the neighbours were last mounted for; stale means "not yet".
  const [readyFor, setReadyFor] = useState<string | null>(null);
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
  const fade = useSharedValue(1);
  const startX = useSharedValue(0);
  const busy = useSharedValue(false);
  // Web touch gating: where the touch landed, and whether it is a finger at all.
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchOk = useSharedValue(false);

  const prevMonth = useMemo(() => moveMonth(month, -1), [month]);
  const nextMonth = useMemo(() => moveMonth(month, 1), [month]);
  const canForward = !(max != null && nextMonth > max);
  const pagesEnabled = !disabled && width > 0;
  const swipeEnabled = pagesEnabled && Boolean(settings.swipeBetweenMonths);
  const neighbours = pagesEnabled && readyFor === month;
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
      setReadyFor(month);
    });
    return () => handle.cancel();
  }, [month, width]);
  const markReady = useCallback(() => {
    setPaging(true);
    setReadyFor(monthRef.current);
  }, []);
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
    translateX.set(0);
    busy.set(false);
    if (reduced) fade.set(withTiming(1, { duration: CROSSFADE_IN }));
    else fade.set(1);
  }, [month, reduced, translateX, busy, fade]);

  const commit = useCallback(
    (direction: 1 | -1, haptic: boolean) => {
      if (haptic) hapticSelection();
      const from = monthRef.current;
      onChangeRef.current(
        moveMonth(from, direction),
        direction > 0 ? "right" : "left",
      );
      // A parent that declines the change must not leave the pages stranded off-screen.
      setTimeout(() => {
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
        withTiming(0, { duration: CROSSFADE_OUT }, (finished) => {
          if (finished) runOnJS(commit)(direction, haptic);
          else busy.set(false);
        }),
      );
      return;
    }
    translateX.set(
      withSpring(
        -direction * sign * width,
        { ...spring, velocity, overshootClamping: true },
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
            runOnJS(markReady)();
          });
    const pan = activating
      .onStart(() => {
        cancelAnimation(translateX);
        startX.set(translateX.get());
      })
      .onUpdate((event) => {
        if (busy.get() || reduced) return;
        const raw = startX.get() + event.translationX;
        const towardForward = raw * sign < 0;
        const followed =
          towardForward && !canForward ? raw * BLOCKED_FOLLOW : raw;
        translateX.set(Math.max(-width, Math.min(width, followed)));
      })
      // The refs behind `commit` are only read when an animation finishes, never in render.
      // eslint-disable-next-line react-hooks/refs
      .onEnd((event) => {
        if (busy.get()) return;
        const direction = resolveSwipe(
          event.translationX,
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
    spring,
    blockedBy,
    markReady,
    clearReady,
    endPaging,
    commit,
    touchX,
    touchY,
    touchOk,
    translateX,
    startX,
    busy,
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
      width,
      sign,
      spring,
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
        {neighbours ? (
          <PagerPage
            key={prevMonth}
            offset={-sign * width}
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
        <PagerPage
          key={month}
          offset={0}
          width={width}
          translateX={translateX}
          fade={fade}
          current
          initial={!booted}
          paging={paging}
        >
          {renderPage(month, { isCurrent: true })}
        </PagerPage>
        {neighbours && canForward ? (
          <PagerPage
            key={nextMonth}
            offset={sign * width}
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
  offset,
  width,
  translateX,
  fade,
  current,
  initial,
  paging,
  children,
}: {
  offset: number;
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
  const slot = useSharedValue(offset);
  useLayoutEffect(() => {
    slot.set(offset);
  }, [offset, slot]);
  const animated = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [{ translateX: slot.get() + translateX.get() }],
  }));
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
