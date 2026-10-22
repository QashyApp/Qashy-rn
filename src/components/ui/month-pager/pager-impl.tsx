import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, type LayoutChangeEvent } from "react-native";
import {
  Gesture,
  GestureDetector,
  PointerType,
} from "react-native-gesture-handler";
import {
  cancelAnimation,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { commitSpring, resolveSwipe } from "@/components/ui/resolve-swipe";
import { useLocalization } from "@/localization/localization";
import { useFinanceSettings } from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { moveMonth } from "@/utils/date";
import { hapticSelection } from "@/services/haptics";
import {
  MonthPagerProps,
  WEB,
  monthAtIndex,
  monthIndex,
} from "@/components/ui/month-pager/pager-model";
import { PagerPage } from "@/components/ui/month-pager/pager-page";

/** Pans that start this close to a screen edge are left to the system back gesture. */
const EDGE_GUARD = 24;
/** Past the newest allowed month the pages barely follow the finger. */
const BLOCKED_FOLLOW = 0.12;
const CROSSFADE_OUT = 90;
const CROSSFADE_IN = 140;
/**
 * If the parent has not shown a requested month after this long, it declined: put the pages back
 * on the month it shows. Generous, so a slow render is never mistaken for a refusal.
 */
const COMMIT_TIMEOUT = 1500;

export function PagerImpl({
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

  const sign = isRtl ? -1 : 1;
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
  // against this. It is the UI thread's own truth: a landed slide moves it at once, and React's
  // month catches up afterwards, so the next swipe never waits on a render.
  const baseIndex = useSharedValue(monthIndex(month));
  // The month React last rendered, and the newest month a slide asked React for (0 when React has
  // caught up). Together they tell a render this pager asked for from a jump made elsewhere.
  const renderedIndex = useSharedValue(monthIndex(month));
  const requestedIndex = useSharedValue(0);
  const maxIndex = useSharedValue(max != null ? monthIndex(max) : Infinity);
  const fade = useSharedValue(1);
  const startX = useSharedValue(0);
  // A commit slide (or crossfade) is in flight.
  const busy = useSharedValue(false);
  // This gesture moves the pages.
  const tracking = useSharedValue(false);
  // The direction of the commit slide in flight; 0 once it has landed or been cut short.
  const pendingDir = useSharedValue<-1 | 0 | 1>(0);
  // Native: only the very first touch needs to reach JS (to mount the neighbours early).
  const warmed = useSharedValue(false);
  // Web touch gating: where the touch landed, and whether it is a finger at all.
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchOk = useSharedValue(false);

  // `dragProgress` is an absolute position, not just the drag: the drag in page widths minus the
  // centre month's index (flipped for right-to-left), continuous across a landing.
  useAnimatedReaction(
    () => (width > 0 ? translateX.get() / width : 0) - baseIndex.get() * sign,
    (position) => {
      if (dragProgress) dragProgress.set(position);
    },
    [width, dragProgress, sign],
  );

  const prevMonth = useMemo(() => moveMonth(month, -1), [month]);
  const nextMonth = useMemo(() => moveMonth(month, 1), [month]);
  const canForward = !(max != null && nextMonth > max);
  const pagesEnabled = !disabled && width > 0;
  const swipeEnabled = pagesEnabled && Boolean(settings.swipeBetweenMonths);
  const neighbours = slide && pagesEnabled && (WEB ? readyFor === month : warm);

  // Latest props for callbacks that outlive a render (animation completions).
  const monthRef = useRef(month);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    monthRef.current = month;
    onChangeRef.current = onChange;
  });

  // Mount the neighbours once the month swap's frames have run, or on the first touch if that is
  // sooner. (RN 0.88 removed `InteractionManager`, which used to defer this.)
  useEffect(() => {
    if (WEB || width <= 0) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setWarm(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [month, width]);
  const markReady = useCallback(() => {
    setPaging(true);
    setWarm(true);
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

  useLayoutEffect(() => {
    const limit = max != null ? monthIndex(max) : Infinity;
    runOnUI(() => {
      "worklet";
      maxIndex.set(limit);
    })();
  }, [max, maxIndex]);

  // React has rendered `month`. A render this pager asked for needs nothing: the pages are already
  // there. Anything else (the month picker, a deep link, a parent that declined) puts the pages on
  // the new month at once.
  useLayoutEffect(() => {
    const index = monthIndex(month);
    runOnUI(() => {
      "worklet";
      const previous = renderedIndex.get();
      renderedIndex.set(index);
      const requested = requestedIndex.get();
      if (requested !== 0) {
        if (index === requested) {
          requestedIndex.set(0);
          busy.set(false);
        } else if (
          Math.min(previous, requested) < index &&
          index < Math.max(previous, requested)
        ) {
          // An earlier slide of a run that is still landing: the newest one follows.
          return;
        } else {
          requestedIndex.set(0);
        }
      }
      if (reduced)
        fade.set(withTiming(1, { duration: CROSSFADE_IN * fadeScale }));
      else fade.set(1);
      if (requested === index || baseIndex.get() === index) return;
      cancelAnimation(translateX);
      tracking.set(false);
      pendingDir.set(0);
      busy.set(false);
      baseIndex.set(index);
      translateX.set(0);
      dragProgress?.set(-index * sign);
    })();
  }, [
    month,
    reduced,
    fadeScale,
    baseIndex,
    renderedIndex,
    requestedIndex,
    translateX,
    dragProgress,
    sign,
    busy,
    fade,
    tracking,
    pendingDir,
  ]);

  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(commitTimer.current), []);
  const commit = useCallback(
    (index: number, direction: 1 | -1, haptic: boolean) => {
      if (haptic) hapticSelection();
      onChangeRef.current(
        monthAtIndex(index),
        direction > 0 ? "right" : "left",
      );
      // A parent that declines the change must not leave the pages on a month it never shows.
      clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        if (monthRef.current === monthAtIndex(index)) return;
        const rendered = monthIndex(monthRef.current);
        runOnUI(() => {
          "worklet";
          if (requestedIndex.get() !== index) return;
          requestedIndex.set(0);
          cancelAnimation(translateX);
          tracking.set(false);
          pendingDir.set(0);
          busy.set(false);
          baseIndex.set(rendered);
          translateX.set(0);
          fade.set(1);
        })();
        setPaging(false);
      }, COMMIT_TIMEOUT);
    },
    [requestedIndex, translateX, tracking, pendingDir, busy, baseIndex, fade],
  );

  /**
   * The slide toward `direction` is over: the next month becomes the centre right here, on the UI
   * thread, with the pages and the title exactly where they were. React is told the absolute month
   * and renders it in its own time; the pages already in place cover it meanwhile.
   */
  const land = (direction: 1 | -1, haptic: boolean) => {
    "worklet";
    pendingDir.set(0);
    const next = baseIndex.get() + direction;
    baseIndex.set(next);
    translateX.set(translateX.get() + direction * sign * width);
    requestedIndex.set(next);
    runOnJS(commit)(next, direction, haptic);
  };

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
    pendingDir.set(direction);
    if (reduced) {
      fade.set(
        withTiming(0, { duration: CROSSFADE_OUT * fadeScale }, (finished) => {
          if (finished && pendingDir.get() === direction) {
            translateX.set(-direction * sign * width);
            land(direction, haptic);
          } else {
            pendingDir.set(0);
            busy.set(false);
          }
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
          // too small to see.
          energyThreshold:
            width > 0 ? Math.max(1e-7, (0.5 / width) ** 2) : 1e-6,
        },
        (finished) => {
          // A touch that grabbed the slide has already landed it; the cut-off spring says nothing.
          if (finished && pendingDir.get() === direction)
            land(direction, haptic);
        },
      ),
    );
  };

  const gesture = useMemo(() => {
    // Every callback below is marked `worklet`: the chain is split, so the babel plugin does not
    // workletize them on its own, and without it the gesture runs on the JS thread, queued behind
    // each month's render.
    const base = Gesture.Pan()
      .enabled(swipeEnabled)
      .hitSlop({ left: -EDGE_GUARD, right: -EDGE_GUARD });
    const activating = WEB
      ? // Manual activation so only a finger can start a swipe: the pointer type is checked on
        // touch-down, then the same 24px horizontal / 14px vertical thresholds apply.
        base
          .manualActivation(true)
          .onTouchesDown((event, manager) => {
            "worklet";
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
            "worklet";
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
            "worklet";
            if (warmed.get()) return;
            warmed.set(true);
            runOnJS(markReady)();
          });
    const pan = activating
      // The refs behind `commit` are only read when a touch grabs a slide, never in render.
      // eslint-disable-next-line react-hooks/refs
      .onStart(() => {
        "worklet";
        if (busy.get()) {
          // A crossfade owns the page until it is done.
          if (reduced || pendingDir.get() === 0) {
            tracking.set(false);
            return;
          }
          // A slide in flight lands where it is, and this touch carries on from the new month:
          // there is no dead moment between swipes.
          cancelAnimation(translateX);
          land(pendingDir.get() as 1 | -1, false);
        }
        tracking.set(true);
        cancelAnimation(translateX);
        startX.set(translateX.get());
      })
      .onUpdate((event) => {
        "worklet";
        if (!tracking.get() || reduced) return;
        const raw = startX.get() + event.translationX;
        const towardForward = raw * sign < 0;
        const followed =
          towardForward && baseIndex.get() + 1 > maxIndex.get()
            ? raw * BLOCKED_FOLLOW
            : raw;
        translateX.set(Math.max(-width, Math.min(width, followed)));
      })
      // The refs behind `commit` are only read when an animation finishes, never in render.
      // eslint-disable-next-line react-hooks/refs
      .onEnd((event) => {
        "worklet";
        if (!tracking.get()) return;
        tracking.set(false);
        const direction = resolveSwipe(
          // The whole offset, not just this touch: a spring-back caught mid-way keeps its start.
          startX.get() + event.translationX,
          event.velocityX,
          width,
          baseIndex.get() + 1 <= maxIndex.get(),
          isRtl,
        );
        settle(direction, direction === 0 ? 0 : event.velocityX, true);
      })
      // A touch that never became a committed swipe (a tap, a scroll, a spring-back).
      .onFinalize(() => {
        "worklet";
        if (!busy.get()) runOnJS(endPaging)();
      });
    return blockedBy?.length
      ? pan.requireExternalGestureToFail(...blockedBy)
      : pan;
    // `settle` and `land` close over exactly the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    swipeEnabled,
    width,
    isRtl,
    sign,
    reduced,
    fadeScale,
    spring,
    committing,
    blockedBy,
    markReady,
    warmed,
    clearReady,
    endPaging,
    commit,
    touchX,
    touchY,
    touchOk,
    translateX,
    baseIndex,
    maxIndex,
    requestedIndex,
    startX,
    busy,
    tracking,
    fade,
    pendingDir,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      goTo: (direction) => {
        if (busy.get()) return;
        if (direction > 0 && baseIndex.get() + 1 > maxIndex.get()) return;
        setPaging(true);
        // Without pages beside it there is nothing to slide; the title still follows a slide
        // when the pager only drives `dragProgress`.
        if (disabled || (slide && !neighbours)) {
          runOnUI((to: 1 | -1) => {
            "worklet";
            // As if a slide had just reached the next month, so landing swaps in place.
            translateX.set(-to * sign * width);
            land(to, false);
          })(direction);
          return;
        }
        settle(direction, 0, false);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      neighbours,
      slide,
      disabled,
      reduced,
      fadeScale,
      width,
      sign,
      spring,
      committing,
      commit,
      busy,
      baseIndex,
      maxIndex,
      translateX,
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
