import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  type HostInstance,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
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
import {
  SWIPE_ACTIVE_OFFSET,
  commitSpring,
  resolveRelease,
  resolveSwipe,
} from "@/components/ui/resolve-swipe";
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
import {
  canStep,
  landedOffset,
} from "@/components/ui/month-pager/pager-motion";
import { PagerPage } from "@/components/ui/month-pager/pager-page";
import {
  WHEEL_QUIET,
  wheelPixels,
  wheelStep,
} from "@/components/ui/month-pager/wheel-step";

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
/**
 * Web only. How long the neighbouring pages stay mounted once the last touch, tap or wheel step is
 * over. A run of swipes (or taps on the arrows) is not interrupted by pages being unmounted and
 * mounted again between them; a page left alone holds no duplicate content.
 */
const NEIGHBOUR_IDLE_MS = 1500;
/** Web trackpad: the quiet gap that ends a gesture (the distance that makes a step is in `wheel-step`). */
const WHEEL_IDLE_MS = 140;

/** Whether the wheel's target sits in something that scrolls sideways by itself. */
function inHorizontalScroller(target: EventTarget | null, stop: Element) {
  let node = target instanceof Element ? target : null;
  while (node && node !== stop) {
    if (
      node.scrollWidth > node.clientWidth &&
      /auto|scroll/.test(getComputedStyle(node).overflowX)
    )
      return true;
    node = node.parentElement;
  }
  return false;
}

/** Keeps a trackpad's sideways scroll, and the browser's history swipe, from leaving the pager. */
const WEB_CONTAINER_STYLE: ViewStyle | undefined = WEB
  ? ({ overscrollBehaviorX: "contain" } as ViewStyle)
  : undefined;

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
  // Springing back to where the drag began is critically damped too: an underdamped spring that is
  // clamped at its target stops dead at speed.
  const settling = useMemo(() => commitSpring(spring), [spring]);
  // A committed slide is stiffer than the theme's own spring: the next swipe cannot start until it
  // lands, so every millisecond of settling is a millisecond of apparent lag.
  const committing = useMemo(
    () => commitSpring({ ...spring, stiffness: spring.stiffness * 1.6 }),
    [spring],
  );

  const sign = isRtl ? -1 : 1;
  const [width, setWidth] = useState(0);
  // Web: whether the neighbours are mounted. Not before a touch (or a wheel step) asks for them,
  // and not for long after the last one (see `NEIGHBOUR_IDLE_MS`).
  const [webReady, setWebReady] = useState(false);
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
  // This drag has gone past the distance a release would commit at (the haptic tick marks it).
  const armed = useSharedValue(false);
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
  const neighbours = slide && pagesEnabled && (WEB ? webReady : warm);
  // Done once within about half a pixel. The default keeps running for ~250ms of motion too small
  // to see.
  const energyThreshold = width > 0 ? Math.max(1e-7, (0.5 / width) ** 2) : 1e-6;

  // Latest props for callbacks that outlive a render (animation completions).
  const monthRef = useRef(month);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    monthRef.current = month;
    onChangeRef.current = onChange;
  });

  // Mount the neighbours once the month swap's frames have run, or on the first touch if that is
  // sooner. (RN 0.88 removed `InteractionManager`, so this does not use it.)
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
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  // Web: starts the countdown after which the neighbours are unmounted again.
  const scheduleIdle = useCallback(() => {
    if (!WEB) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setWebReady(false), NEIGHBOUR_IDLE_MS);
  }, []);
  const markReady = useCallback(() => {
    setPaging(true);
    setWarm(true);
    // A finger is on the pages: they stay for as long as it is.
    clearTimeout(idleTimer.current);
    if (WEB) setWebReady(true);
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

  useLayoutEffect(() => {
    const limit = max != null ? monthIndex(max) : Infinity;
    runOnUI(() => {
      "worklet";
      maxIndex.set(limit);
    })();
  }, [max, maxIndex]);

  // React has rendered `month`. A render this pager asked for needs nothing: the pages are already
  // there. Anything else (the month picker, a deep link, a parent that declined) puts the pages on
  // the new month at once. `busy` is not touched by a render this pager asked for: it belongs to
  // the slide in flight, which may be a newer one than the month React has just caught up to.
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
      if (requested !== index && baseIndex.get() !== index) {
        cancelAnimation(translateX);
        tracking.set(false);
        pendingDir.set(0);
        busy.set(false);
        baseIndex.set(index);
        translateX.set(0);
        dragProgress?.set(-index * sign);
      }
      // A crossfade in flight is fading the pages itself.
      if (pendingDir.get() !== 0) return;
      if (reduced)
        fade.set(withTiming(1, { duration: CROSSFADE_IN * fadeScale }));
      else fade.set(1);
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
    (index: number, direction: 1 | -1) => {
      onChangeRef.current(
        monthAtIndex(index),
        direction > 0 ? "right" : "left",
      );
      // Web: the neighbours outlive the slide, for the next one.
      scheduleIdle();
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
    [
      requestedIndex,
      translateX,
      tracking,
      pendingDir,
      busy,
      baseIndex,
      fade,
      scheduleIdle,
    ],
  );

  /**
   * The slide toward `direction` is over: the next month becomes the centre right here, on the UI
   * thread, with the pages and the title exactly where they were. React is told the absolute month
   * and renders it in its own time; the pages already in place cover it meanwhile. The pager is
   * free again from this moment (`requestedIndex` is what tells a stale render from a new one), so
   * a touch or a tap before React catches up is never dropped.
   */
  const land = (direction: 1 | -1) => {
    "worklet";
    pendingDir.set(0);
    busy.set(false);
    const next = baseIndex.get() + direction;
    baseIndex.set(next);
    // Re-based, not reset: the pages keep the positions they have on screen right now.
    translateX.set(landedOffset(translateX.get(), direction, sign, width));
    requestedIndex.set(next);
    // A crossfade brings the new month in at once; React's render only has to catch up.
    if (reduced)
      fade.set(withTiming(1, { duration: CROSSFADE_IN * fadeScale }));
    runOnJS(commit)(next, direction);
  };

  /** Lands the slide (or crossfade) in flight, if any, wherever it has got to. */
  const landInFlight = () => {
    "worklet";
    const direction = pendingDir.get();
    if (!busy.get() || direction === 0) return false;
    cancelAnimation(translateX);
    cancelAnimation(fade);
    land(direction);
    return true;
  };

  const settle = (direction: -1 | 0 | 1, velocity: number) => {
    "worklet";
    if (direction === 0) {
      if (reduced) {
        // The pages followed the finger; letting go puts them back without a settle.
        translateX.set(0);
        if (WEB) runOnJS(scheduleIdle)();
        return;
      }
      translateX.set(
        withSpring(
          0,
          { ...settling, velocity, overshootClamping: true, energyThreshold },
          (finished) => {
            // Web: the neighbours go once the pages are back and nothing else touches them.
            if (WEB && finished) runOnJS(scheduleIdle)();
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
            land(direction);
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
          energyThreshold,
        },
        (finished) => {
          // A touch that grabbed the slide has already landed it; the cut-off spring says nothing.
          if (finished && pendingDir.get() === direction) land(direction);
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
        // touch-down, then the same horizontal / vertical thresholds apply as on native.
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
            if (Math.abs(dy) > SWIPE_ACTIVE_OFFSET) {
              touchOk.set(false);
              manager.fail();
            } else if (Math.abs(dx) >= SWIPE_ACTIVE_OFFSET) {
              touchOk.set(false);
              runOnJS(markReady)();
              manager.activate();
            }
          })
      : base
          .activeOffsetX([-SWIPE_ACTIVE_OFFSET, SWIPE_ACTIVE_OFFSET])
          .failOffsetY([-SWIPE_ACTIVE_OFFSET, SWIPE_ACTIVE_OFFSET])
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
        // A slide in flight lands where it is, and this touch carries on from the new month: there
        // is no dead moment between swipes. (A crossfade is landed the same way.) The landing
        // leaves a residual offset in `startX`; `resolveRelease` keeps the release from committing
        // against the direction this finger then moves.
        if (busy.get()) {
          if (!landInFlight()) {
            tracking.set(false);
            return;
          }
          if (reduced) fade.set(1);
        }
        tracking.set(true);
        cancelAnimation(translateX);
        startX.set(translateX.get());
        // A drag that begins already past the threshold (a caught spring-back) has not just crossed it.
        armed.set(
          resolveSwipe(
            translateX.get(),
            0,
            width,
            baseIndex.get() + 1 <= maxIndex.get(),
            isRtl,
          ) !== 0,
        );
      })
      .onUpdate((event) => {
        "worklet";
        // The pages follow the finger 1:1 at every animation level: that is direct manipulation,
        // not an animation. Only what happens after release is turned down.
        if (!tracking.get()) return;
        const raw = startX.get() + event.translationX;
        const canForward = baseIndex.get() + 1 <= maxIndex.get();
        const towardForward = raw * sign < 0;
        const followed =
          towardForward && !canForward ? raw * BLOCKED_FOLLOW : raw;
        translateX.set(Math.max(-width, Math.min(width, followed)));
        // One tick as the drag crosses the distance a release would commit at.
        const past = resolveSwipe(raw, 0, width, canForward, isRtl) !== 0;
        if (past !== armed.get()) {
          armed.set(past);
          if (past) runOnJS(hapticSelection)();
        }
      })
      // The refs behind `commit` are only read when an animation finishes, never in render.
      // eslint-disable-next-line react-hooks/refs
      .onEnd((event) => {
        "worklet";
        if (!tracking.get()) return;
        tracking.set(false);
        // A slide that began while this finger was already down (a tap on the arrows racing the
        // touch) must not be left to land after the release: land it now and re-base the grab.
        const inFlight = busy.get() ? pendingDir.get() : 0;
        if (inFlight !== 0 && landInFlight()) {
          startX.set(landedOffset(startX.get(), inFlight, sign, width));
          if (reduced) fade.set(1);
        }
        const direction = resolveRelease(
          // The offset the finger started from, so a spring-back caught mid-way, or a slide
          // grabbed part-way, is judged from where it was and by the way the finger then moved.
          startX.get(),
          event.translationX,
          event.velocityX,
          width,
          baseIndex.get() + 1 <= maxIndex.get(),
          isRtl,
        );
        // A flick that never reached the distance ticks as it is let go.
        if (direction !== 0 && !armed.get()) runOnJS(hapticSelection)();
        settle(direction, event.velocityX);
      })
      // A touch that never became a committed swipe (a tap, a scroll, a spring-back). Paging only
      // ends here once React has caught up with every slide: otherwise the month effect ends it.
      // The refs behind `scheduleIdle` are only read when a touch ends, never in render.
      // eslint-disable-next-line react-hooks/refs
      .onFinalize(() => {
        "worklet";
        if (!busy.get() && requestedIndex.get() === 0) runOnJS(endPaging)();
        if (WEB) runOnJS(scheduleIdle)();
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
    scheduleIdle,
    endPaging,
    commit,
    settling,
    energyThreshold,
    armed,
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

  /**
   * One step from the month switcher, a key or the trackpad. Everything but the answer happens on
   * the UI thread, in the order a swipe would have it: a slide in flight lands where it is, and
   * this one starts from there.
   */
  const goTo = (direction: 1 | -1): boolean => {
    // A finger is moving the pages.
    if (tracking.get()) return false;
    const inFlight = busy.get() ? pendingDir.get() : 0;
    // At the newest month there is nothing to step to: not accepted, so the caller does not tick.
    if (!canStep(direction, baseIndex.get(), inFlight, maxIndex.get()))
      return false;
    setPaging(true);
    scheduleIdle();
    // Without pages beside it there is nothing to slide; the title still follows a slide
    // when the pager only drives `dragProgress`.
    const jump = disabled || (slide && !neighbours);
    runOnUI((to: 1 | -1) => {
      "worklet";
      // A finger came down after the call: it owns the pages, and the step is dropped.
      if (tracking.get()) return;
      landInFlight();
      if (!canStep(to, baseIndex.get(), 0, maxIndex.get())) {
        runOnJS(endPaging)();
        return;
      }
      if (jump) {
        // As if a slide had just reached the next month, so landing swaps in place.
        translateX.set(-to * sign * width);
        land(to);
        return;
      }
      settle(to, 0);
    })(direction);
    return true;
  };
  const goToRef = useRef(goTo);
  useLayoutEffect(() => {
    goToRef.current = goTo;
  });
  const handle = useMemo(
    () => ({ goTo: (direction: 1 | -1) => goToRef.current(direction) }),
    [],
  );
  useImperativeHandle(ref, () => handle, [handle]);

  // Web trackpad: a two-finger sideways scroll steps a month, once per gesture. The listener is
  // native and not passive so the browser's own sideways overscroll (history navigation) can be
  // refused while the pager has the gesture.
  const containerRef = useRef<HostInstance>(null);
  const neighboursRef = useRef(neighbours);
  useLayoutEffect(() => {
    neighboursRef.current = neighbours;
  });
  useEffect(() => {
    if (!WEB || !swipeEnabled) return;
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    let gesture = WHEEL_QUIET;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    // The two frames a step waits for the neighbours to mount; cancelled with the effect.
    let outer = 0;
    let inner = 0;
    const cancelFrames = () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    const step = (direction: 1 | -1) => {
      if (neighboursRef.current || !slide) {
        goToRef.current(direction);
        return;
      }
      // At the newest month there is no step to take: mounting the neighbours would be for nothing.
      if (
        !canStep(
          direction,
          baseIndex.get(),
          busy.get() ? pendingDir.get() : 0,
          maxIndex.get(),
        )
      )
        return;
      // Mount the neighbours first and slide once they are in, rather than jumping.
      markReady();
      cancelFrames();
      outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          goToRef.current(direction);
          scheduleIdle();
        });
      });
    };
    const onWheel = (event: WheelEvent) => {
      const dx = wheelPixels(event.deltaMode, event.deltaX);
      const dy = wheelPixels(event.deltaMode, event.deltaY);
      // Pinch-zoom, a mostly vertical scroll, or something inside the page that scrolls sideways.
      if (event.ctrlKey || Math.abs(dx) <= Math.abs(dy)) return;
      if (inHorizontalScroller(event.target, node)) return;
      event.preventDefault();
      // A trackpad's inertia keeps the events coming after the fingers lift: they belong to the
      // gesture that already stepped, until the wheel has been quiet for a moment.
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        gesture = WHEEL_QUIET;
      }, WHEEL_IDLE_MS);
      const next = wheelStep(gesture, dx, sign, busy.get());
      gesture = next.gesture;
      if (next.direction !== 0) step(next.direction);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      clearTimeout(quiet);
      cancelFrames();
    };
  }, [
    swipeEnabled,
    slide,
    sign,
    busy,
    baseIndex,
    maxIndex,
    pendingDir,
    markReady,
    scheduleIdle,
  ]);

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
        ref={containerRef}
        collapsable={false}
        onLayout={onLayout}
        style={[
          { flex: 1, overflow: "hidden", backgroundColor: background },
          WEB_CONTAINER_STYLE,
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
