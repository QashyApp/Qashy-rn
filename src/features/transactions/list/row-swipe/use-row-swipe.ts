/* eslint-disable react-hooks/refs -- the gesture and its worklets run later, off the render path; they only read shared values and refs */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useWindowDimensions } from "react-native";
import {
  Gesture,
  GestureStateManager,
  PointerType,
} from "react-native-gesture-handler";
import {
  cancelAnimation,
  runOnJS,
  runOnUI,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useMotionPreference } from "@/components/ui/motion";
import {
  actionLeavesList,
  isDestructiveAction,
  type RowSwipeActionKind,
  type RowSwipeActions,
} from "@/features/transactions/list/row-swipe/row-swipe-actions";
import {
  EDGE_GUARD_OPEN_BUTTON,
  ROW_REVEAL_WIDTH,
  classifyMove,
  commitOffset,
  displayOffset,
  findRowAt,
  isPastCommitLine,
  resolveRowSwipe,
  settleOffset,
  springArrivalMs,
  touchStartsAtEdge,
  type RowSwipeSide,
} from "@/features/transactions/list/row-swipe/resolve-row-swipe";
import { hapticImpactLight } from "@/services/haptics";
import { useQashyTheme } from "@/theme/theme";

const WEB = process.env.EXPO_OS === "web";
/** After a touch that closed an open row, how long a press it produces is still swallowed. */
const TAP_GRACE_MS = 150;
/** How long a spring slide-out takes to be out of sight; the row is hidden from the list after it. */
const SLIDE_OUT_MS = 260;
/** Added to the confirming hold's length so what waits for it starts just after, never during. */
const CONFIRM_MARGIN_MS = 32;

/** One mounted row as the swipe needs to know it: where it is and what each side does. */
export interface SwipeRow {
  id: string;
  /** Content-space edges (see `RowRect`). */
  top: number;
  bottom: number;
  /** The row's left edge in window x (default 0), for placing an open row's button. */
  left?: number;
  width: number;
  actions: RowSwipeActions;
}

export interface RowSwipeOptions {
  /** The device setting, `swipeRowActions`. */
  enabled: boolean;
  isRtl: boolean;
  /**
   * A swipe committed (or a revealed action was pressed): do `kind` to the row. Returns whether it
   * was taken; a refusal (the row already has an action) brings a row that slid away back.
   */
  onAction: (
    id: string,
    kind: RowSwipeActionKind,
    /** A row that slides away stays listed this long before it may be hidden. */
    hideDelayMs?: number,
    /**
     * An action that keeps its row holds on its checkmark this long (from now) before the row
     * closes; an action that opens something over the list waits this long so the hold is seen.
     * Absent when the row has no hold (the action leaves the list, or motion is off).
     */
    holdMs?: number,
  ) => boolean;
}

/**
 * The one swipe gesture for a screen's transaction lists (not one per row), plus the shared state
 * the rows draw from. The screen creates it so the same gesture object can be handed to the month
 * pager as `blockedBy` and attached to the current page's list.
 *
 * Everything per touch runs on the UI thread. The list publishes the mounted rows' positions
 * (`publish`) and its scroll offset; a touch-down hit-tests them and fails at once when no row is
 * under the finger, so the pager's month swipe waits for nothing in headers or empty space. The
 * exception is a list that has scrolled since it was last measured (`markStale`, or any scroll):
 * a row that just scrolled in may not be in the cache yet, so a touch that misses waits for the
 * first sideways move, measures then (`setMeasurer`), and decides the moment the measurement
 * answers (it activates or fails the gesture by its handler tag, `GestureStateManager`), without
 * needing another move. On a row, the touch becomes a swipe at 12dp sideways, inside a 45 degree
 * cone around the horizontal, and fails at 12dp vertically outside it (a scroll). On native, touches
 * within 24dp of a screen edge, 16dp on the revealed button of an open row, are the system back
 * gesture's (a browser has none). A second finger, or the swipe being suspended, mid-swipe never
 * leaves the row part-way: the first is ignored, the second lets the row go shut.
 *
 * Only one row is ever open or being dragged: `activeId`/`activeX` describe it, `closingId`/
 * `closingX` the one that is still sliding shut, and `committingId`/`committingX` the one that was
 * swiped away and is still on its way out (its action has already been handed to the screen, and
 * nothing a later touch does may pull it back). A row reads its own offset from them
 * (`useRowSwipeOffset`), so nothing re-renders mid-drag.
 */
export interface RowSwipeController {
  /** The device setting is on: rows draw their action layers and slide. */
  enabled: boolean;
  /** Attach to the current page's list, and pass to the pager as `blockedBy`. */
  gesture: ReturnType<typeof Gesture.Pan>;
  activeId: SharedValue<string>;
  activeX: SharedValue<number>;
  closingId: SharedValue<string>;
  closingX: SharedValue<number>;
  committingId: SharedValue<string>;
  committingX: SharedValue<number>;
  /**
   * The row whose action was taken and stays in the list: it holds at the reveal line a moment
   * with a checkmark before it closes.
   */
  confirmingId: SharedValue<string>;
  revealWidth: number;
  isRtl: boolean;
  /** Replaces the mounted rows. Call after each geometry pass or when the actions change. */
  publish(rows: readonly SwipeRow[]): void;
  /**
   * Forgets the published rows (the list is no longer the current page). Unlike `publish([])` the
   * rows are not known to be right, so a touch that misses them is still not final.
   */
  clear(): void;
  /** The list's scroll offset, for hit-testing against content-space rows. */
  setScrollOffset(y: number): void;
  /** The mounted rows may have changed since they were published: a miss is not final yet. */
  markStale(): void;
  /**
   * How a touch that missed the published rows measures them again before it is given up. The
   * promise settles once the measurement is in (published, or discarded because the list moved
   * meanwhile). Null where there is nothing to measure.
   */
  setMeasurer(measure: (() => Promise<unknown>) | null): void;
  /** Stops the gesture from starting (selection mode, a drag-select) while any reason is on. */
  suspend(reason: string, on: boolean): void;
  /** Slides the open row shut. */
  close(): void;
  /** A press that should close an open row instead of opening it. */
  shouldSwallowPress(id: string): boolean;
  /** A revealed action was pressed: take the action as a full swipe would. */
  commit(id: string, side: RowSwipeSide): void;
  /** Brings a row that slid away back to rest (its action was undone or failed). */
  release(id: string): void;
}

export function useRowSwipe({
  enabled,
  isRtl,
  onAction,
}: RowSwipeOptions): RowSwipeController {
  const { motion } = useQashyTheme();
  const { instant, travel } = useMotionPreference();
  const { width: windowWidth } = useWindowDimensions();
  const spring = motion.spring.snappy;
  const quick = motion.duration.fast;
  // How long a non-leaving action holds at the reveal line, checkmark showing, before it closes.
  const hold = motion.duration.base;

  const ids = useSharedValue<string[]>([]);
  const tops = useSharedValue<number[]>([]);
  const bottoms = useSharedValue<number[]>([]);
  const widths = useSharedValue<number[]>([]);
  const lefts = useSharedValue<number[]>([]);
  // Bit 0: the start side has an action. Bit 1: the end side has one.
  const sideMasks = useSharedValue<number[]>([]);
  // The same bits, for actions that take the row out of the list.
  const leaveMasks = useSharedValue<number[]>([]);
  // The same bits, for actions that erase (a fling alone must not take them).
  const destructiveMasks = useSharedValue<number[]>([]);
  const scrollOffset = useSharedValue(0);
  // The rows may have changed since they were published, so a touch that misses them is not final.
  const stale = useSharedValue(false);
  const suspended = useSharedValue(false);

  const activeId = useSharedValue("");
  const activeX = useSharedValue(0);
  const closingId = useSharedValue("");
  const closingX = useSharedValue(0);
  const committingId = useSharedValue("");
  const committingX = useSharedValue(0);
  // The row whose action was just taken but which stays in the list (it settles shut): a second
  // press of its still-visible button must not take the action again.
  const lockedId = useSharedValue("");
  const confirmingId = useSharedValue("");

  // 0 idle, 1 a finger is on a row and has not decided, 2 the swipe owns the touch, 3 a finger
  // landed where no published row is while the rows may be stale: it waits for its first sideways
  // move, then measures (`lookupState`: 0 not asked, 1 measuring, 2 answered) and decides the
  // moment the measurement is in.
  const phase = useSharedValue(0);
  const lookupState = useSharedValue(0);
  const touchToken = useSharedValue(0);
  const trackId = useSharedValue("");
  const trackIndex = useSharedValue(-1);
  const startOffset = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  // Where the current touch landed in content space (window y plus the scroll offset then), and
  // the handler tag the touch events carry, to decide from outside a touch callback.
  const touchContentY = useSharedValue(0);
  const handlerTag = useSharedValue(-1);
  const crossed = useSharedValue(false);

  const rowsById = useRef(new Map<string, SwipeRow>());
  const latest = useRef({ onAction });
  useEffect(() => {
    latest.current = { onAction };
  });
  const reasons = useRef(new Set<string>());
  /** The row that rests open, as far as JS needs to know (to swallow its content's press). */
  const openId = useRef<string | null>(null);
  const staleMirror = useRef(false);
  const lastScrollY = useRef(0);
  const measurer = useRef<(() => Promise<unknown>) | null>(null);
  const tapClosed = useRef(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const controller = useMemo(() => {
    const setOpen = (id: string | null) => {
      openId.current = id;
    };
    const noteTapClosed = () => {
      tapClosed.current = true;
      clearTimeout(tapTimer.current);
    };
    const releaseTap = () => {
      if (!tapClosed.current) return;
      clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => {
        tapClosed.current = false;
      }, TAP_GRACE_MS);
    };

    /** Moves `target` to `to`: a spring, or a short timing when motion is reduced. */
    const animate = (
      target: SharedValue<number>,
      to: number,
      velocity: number,
      done?: (finished?: boolean) => void,
      delay = 0,
    ) => {
      "worklet";
      if (instant) {
        cancelAnimation(target);
        target.set(to);
        if (done) done(true);
        return;
      }
      const animation = travel
        ? withSpring(to, { ...spring, velocity, overshootClamping: true }, done)
        : withTiming(to, { duration: quick }, done);
      target.set(delay > 0 ? withDelay(delay, animation) : animation);
    };

    /** Hands the open row to the closing slot and slides it shut. */
    const startClosing = () => {
      "worklet";
      const id = activeId.get();
      if (id === "") return;
      cancelAnimation(activeX);
      const from = activeX.get();
      activeId.set("");
      activeX.set(0);
      runOnJS(setOpen)(null);
      if (from === 0) return;
      cancelAnimation(closingX);
      closingId.set(id);
      closingX.set(from);
      animate(closingX, 0, 0, (finished) => {
        "worklet";
        if (!finished) return;
        if (closingId.get() === id) closingId.set("");
        if (confirmingId.get() === id) confirmingId.set("");
      });
    };

    const settleTo = (
      settle: "closed" | "open-start" | "open-end",
      id: string,
      velocity: number,
    ) => {
      "worklet";
      animate(
        activeX,
        settleOffset(settle, ROW_REVEAL_WIDTH, isRtl),
        velocity,
        (finished) => {
          "worklet";
          if (
            finished &&
            settle === "closed" &&
            activeId.get() === id &&
            activeX.get() === 0
          )
            activeId.set("");
          if (finished && settle === "closed" && lockedId.get() === id)
            lockedId.set("");
        },
      );
      runOnJS(setOpen)(settle === "closed" ? null : id);
    };

    /** Brings a row that slid away back to rest, and lifts the lock of a repeated press. */
    const releaseRow = (id: string) => {
      runOnUI(() => {
        "worklet";
        if (lockedId.get() === id) lockedId.set("");
        if (committingId.get() !== id) return;
        animate(committingX, 0, 0, () => {
          "worklet";
          if (committingId.get() === id) committingId.set("");
        });
      })();
    };

    /**
     * An action that keeps its row in the list (Mark paid, Change category): the row springs back
     * to the reveal line, holds there with the checkmark showing, then closes. Under reduced motion
     * or Animations off there is no hold; the row just closes.
     */
    const confirmThenClose = (
      id: string,
      side: RowSwipeSide,
      velocity: number,
    ) => {
      "worklet";
      if (instant) {
        settleTo("closed", id, velocity);
        return;
      }
      confirmingId.set(id);
      const line = settleOffset(
        side === "start" ? "open-start" : "open-end",
        ROW_REVEAL_WIDTH,
        isRtl,
      );
      animate(activeX, line, velocity, (reached) => {
        "worklet";
        if (!reached) return;
        animate(
          activeX,
          0,
          0,
          (closed) => {
            "worklet";
            if (!closed) return;
            if (activeId.get() === id && activeX.get() === 0) activeId.set("");
            if (lockedId.get() === id) lockedId.set("");
            if (confirmingId.get() === id) confirmingId.set("");
          },
          hold,
        );
      });
    };

    /**
     * `reachMs` is how long the row takes to get to the reveal line (measured by the commit from
     * where it is and how fast it let go); an action that keeps its row then holds `hold` more.
     */
    const handleCommit = (id: string, side: RowSwipeSide, reachMs = 0) => {
      const kind = rowsById.current.get(id)?.actions[side];
      let taken = false;
      try {
        if (kind) {
          // A row that slides away is hidden from the list only once it is out of sight. The
          // screen brings it back (`release`) when its action is undone or fails.
          const slideMs = instant ? 0 : travel ? SLIDE_OUT_MS : quick;
          const leaves = actionLeavesList(kind);
          taken = latest.current.onAction(
            id,
            kind,
            leaves ? slideMs : undefined,
            leaves || instant ? undefined : reachMs + hold + CONFIRM_MARGIN_MS,
          );
        }
      } finally {
        // Refused, gone or thrown: nothing will ever hide this row, so it must not stay slid off.
        if (!taken) releaseRow(id);
      }
    };

    /**
     * A release (or a pressed action) that commits `side` of row `id`. The action is handed to JS
     * right here, not when the slide finishes: a slide that a later touch interrupts reports
     * `finished: false`, and the action must not depend on it. A row that leaves moves to its own
     * slot for the slide, so closing the open row or touching another can neither cancel it nor
     * leave it part-way.
     */
    const runCommit = (
      id: string,
      side: RowSwipeSide,
      leaves: boolean,
      width: number,
      velocity: number,
    ) => {
      "worklet";
      if (!leaves) {
        // Where the row is now and how long it takes to get to the line from there, with the speed
        // it was let go at: the hold, and whatever waits for it, starts only then.
        const from = activeId.get() === id ? activeX.get() : 0;
        const line = settleOffset(
          side === "start" ? "open-start" : "open-end",
          ROW_REVEAL_WIDTH,
          isRtl,
        );
        const reachMs = travel
          ? springArrivalMs(spring, from - line, velocity)
          : quick;
        lockedId.set(id);
        activeId.set(id);
        confirmThenClose(id, side, velocity);
        runOnJS(handleCommit)(id, side, reachMs);
        return;
      }
      cancelAnimation(activeX);
      const from = activeId.get() === id ? activeX.get() : 0;
      activeId.set("");
      activeX.set(0);
      cancelAnimation(committingX);
      committingId.set(id);
      committingX.set(from);
      animate(committingX, commitOffset(side, width, isRtl), velocity);
      runOnJS(setOpen)(null);
      // Last, so a refusal that releases the row finds it already in its own slot.
      runOnJS(handleCommit)(id, side);
    };

    /** The finger is on row `id` (the `index`th published): follow it, catching a row still sliding. */
    const trackRow = (index: number, id: string) => {
      "worklet";
      // Catch a row that is still sliding, wherever it is.
      if (lockedId.get() === id) lockedId.set("");
      if (confirmingId.get() === id) confirmingId.set("");
      let from = 0;
      if (activeId.get() === id) {
        cancelAnimation(activeX);
        from = activeX.get();
      } else if (closingId.get() === id) {
        cancelAnimation(closingX);
        from = closingX.get();
        closingId.set("");
      }
      phase.set(1);
      trackId.set(id);
      trackIndex.set(index);
      startOffset.set(from);
    };

    /** Whether a published row can be swiped at all: it has an action and is not on its way out. */
    const swipeable = (index: number, id: string) => {
      "worklet";
      return (
        index >= 0 &&
        sideMasks.get()[index] !== 0 &&
        // A row on its way out is not a swipe target: its action has been taken.
        committingId.get() !== id
      );
    };

    /**
     * The touch that missed the rows has been waiting for a sideways move and its measurement; now
     * that the measurement is in, decide it. Runs outside a touch callback, so the gesture is
     * activated or failed by its handler tag.
     */
    const decideAfterLookup = (token: number) => {
      "worklet";
      if (
        touchToken.get() !== token ||
        phase.get() !== 3 ||
        lookupState.get() !== 1
      )
        return;
      lookupState.set(2);
      // Look under the finger's landing point, in content space as it was when it landed.
      const index = findRowAt(tops.get(), bottoms.get(), touchContentY.get());
      const id = index >= 0 ? ids.get()[index] : "";
      if (!swipeable(index, id)) {
        phase.set(0);
        GestureStateManager.fail(handlerTag.get());
        return;
      }
      // The move that asked for the measurement already counts as a swipe.
      trackRow(index, id);
      phase.set(2);
      GestureStateManager.activate(handlerTag.get());
    };

    /** Measures the mounted rows for a touch that missed them, then lets that touch decide. */
    const lookUpRow = (token: number) => {
      const answered = () => {
        runOnUI(decideAfterLookup)(token);
      };
      const measure = measurer.current;
      if (!measure) {
        answered();
        return;
      }
      measure().then(answered, answered);
    };

    /**
     * Gives up a swipe that owns the touch (swipe suspended mid-way): the row goes shut from where
     * it is, and the gesture ends, so nothing is left half open.
     */
    const abandonSwipe = () => {
      "worklet";
      const id = trackId.get();
      phase.set(0);
      crossed.set(false);
      settleTo("closed", id, 0);
    };

    // Native only: a browser has no system back gesture, and a list inset from its window must not
    // lose its edge to a margin that is not the screen's. The slop is a coarse prefilter around the
    // edge guard, `touchStartsAtEdge`, which is exact; it is narrower on purpose, so a touch in the
    // band between them still reaches the touch-down, which admits it only on an open row's button.
    const pan = Gesture.Pan().enabled(enabled);
    const base = WEB
      ? pan
      : pan.hitSlop({
          left: -EDGE_GUARD_OPEN_BUTTON,
          right: -EDGE_GUARD_OPEN_BUTTON,
        });
    const gesture = base
      // Manual activation on both platforms: the touch-down decides whether this gesture exists
      // at all, and the thresholds are applied by hand, as the pager does on the web.
      .manualActivation(true)
      .onTouchesDown((event, manager) => {
        "worklet";
        // Another finger lands while the swipe owns the touch: the swipe carries on with the
        // gesture's own pointer average and settles at the end. Failing it here would end the
        // gesture without a settle and strand the row part-way.
        if (phase.get() === 2 && event.allTouches.length > 1) {
          if (suspended.get()) {
            abandonSwipe();
            manager.fail();
          }
          return;
        }
        const touch = event.allTouches[0];
        if (
          !touch ||
          event.allTouches.length > 1 ||
          suspended.get() ||
          // A finger or a mouse; a pen keeps scrolling and selecting as it always has.
          (WEB &&
            event.pointerType !== PointerType.TOUCH &&
            event.pointerType !== PointerType.MOUSE)
        ) {
          phase.set(0);
          manager.fail();
          return;
        }
        const index = findRowAt(
          tops.get(),
          bottoms.get(),
          touch.absoluteY + scrollOffset.get(),
        );
        const id = index >= 0 ? ids.get()[index] : "";
        // Only a touch on the open row's own button may start this close to the screen edge.
        if (
          !WEB &&
          touchStartsAtEdge(
            touch.absoluteX,
            windowWidth,
            id !== "" && activeId.get() === id ? activeX.get() : 0,
            lefts.get()[index] ?? 0,
            widths.get()[index] ?? windowWidth,
          )
        ) {
          phase.set(0);
          manager.fail();
          return;
        }
        // A touch anywhere but on the open row closes it.
        if (activeId.get() !== "" && activeId.get() !== id) {
          startClosing();
          runOnJS(noteTapClosed)();
        }
        touchX.set(touch.absoluteX);
        touchY.set(touch.absoluteY);
        touchContentY.set(touch.absoluteY + scrollOffset.get());
        handlerTag.set(event.handlerTag);
        touchToken.set(touchToken.get() + 1);
        lookupState.set(0);
        if (index < 0 && stale.get()) {
          // The list scrolled or re-laid out since its rows were measured, so this may be a row
          // that is not in the cache yet. Decide at the first sideways move, once it is measured.
          phase.set(3);
          return;
        }
        if (!swipeable(index, id)) {
          phase.set(0);
          manager.fail();
          return;
        }
        trackRow(index, id);
      })
      .onTouchesMove((event, manager) => {
        "worklet";
        if (phase.get() === 2) {
          // Suspended mid-swipe (selection started, a drag armed): let the row go.
          if (suspended.get()) {
            abandonSwipe();
            manager.fail();
          }
          return;
        }
        const waiting = phase.get() === 3;
        if (phase.get() !== 1 && !waiting) return;
        const touch = event.allTouches[0];
        if (!touch) return;
        if (suspended.get()) {
          phase.set(0);
          manager.fail();
          return;
        }
        const move = classifyMove(
          touch.absoluteX - touchX.get(),
          touch.absoluteY - touchY.get(),
        );
        if (move === "fail") {
          phase.set(0);
          manager.fail();
          return;
        }
        if (waiting) {
          // The first sideways move asks for the measurement; its answer decides (`decideAfterLookup`).
          if (move === "activate" && lookupState.get() === 0) {
            lookupState.set(1);
            runOnJS(lookUpRow)(touchToken.get());
          }
          return;
        }
        if (move === "activate") {
          phase.set(2);
          manager.activate();
        }
      })
      .onStart(() => {
        "worklet";
        cancelAnimation(activeX);
        activeId.set(trackId.get());
        activeX.set(startOffset.get());
        crossed.set(false);
        // A swipe ends in a lift that a browser may still turn into a press on the row.
        runOnJS(noteTapClosed)();
      })
      .onUpdate((event) => {
        "worklet";
        if (phase.get() !== 2) return;
        const index = trackIndex.get();
        const mask = sideMasks.get()[index] ?? 0;
        const sides = { start: (mask & 1) !== 0, end: (mask & 2) !== 0 };
        const width = widths.get()[index] ?? 0;
        const offset = displayOffset(
          startOffset.get() + event.translationX,
          width,
          isRtl,
          sides,
          ROW_REVEAL_WIDTH,
        );
        activeX.set(offset);
        const past = isPastCommitLine(
          offset,
          width,
          ROW_REVEAL_WIDTH,
          isRtl,
          sides,
        );
        if (past !== crossed.get()) {
          crossed.set(past);
          runOnJS(hapticImpactLight)();
        }
      })
      .onEnd((event, success) => {
        "worklet";
        if (phase.get() !== 2) return;
        phase.set(0);
        crossed.set(false);
        const index = trackIndex.get();
        const id = trackId.get();
        const mask = sideMasks.get()[index] ?? 0;
        const width = widths.get()[index] ?? 0;
        const erases = destructiveMasks.get()[index] ?? 0;
        const release = success
          ? resolveRowSwipe({
              offset: activeX.get(),
              velocity: event.velocityX,
              rowWidth: width,
              revealWidth: ROW_REVEAL_WIDTH,
              isRtl,
              sides: { start: (mask & 1) !== 0, end: (mask & 2) !== 0 },
              destructive:
                (erases & 1) !== 0
                  ? "start"
                  : (erases & 2) !== 0
                    ? "end"
                    : null,
            })
          : ({ settle: "closed", commit: null } as const);
        if (release.commit) {
          const bit = release.commit === "start" ? 1 : 2;
          runCommit(
            id,
            release.commit,
            (leaveMasks.get()[index] & bit) !== 0,
            width,
            event.velocityX,
          );
        } else {
          settleTo(release.settle, id, event.velocityX);
        }
      })
      .onFinalize(() => {
        "worklet";
        // A swipe cut short without an end (the touch was cancelled) lets go where it is.
        lookupState.set(0);
        if (phase.get() === 2) {
          phase.set(0);
          crossed.set(false);
          settleTo("closed", trackId.get(), 0);
        }
        phase.set(0);
        runOnJS(releaseTap)();
      });

    /**
     * Puts new row arrays in place. The swipe under way is tracked by an index into them, which
     * moves when a row above it leaves or arrives, so the index is found again by the tracked
     * row's id: reading the neighbour's width and sides would drag the wrong row's geometry (and a
     * commit would take the neighbour's leaving or staying path). A tracked row that is gone ends
     * the swipe: the row settles shut and the gesture fails.
     */
    const adoptRows = (next: {
      ids: string[];
      tops: number[];
      bottoms: number[];
      widths: number[];
      lefts: number[];
      sideMasks: number[];
      leaveMasks: number[];
      destructiveMasks: number[];
    }) => {
      "worklet";
      ids.set(next.ids);
      tops.set(next.tops);
      bottoms.set(next.bottoms);
      widths.set(next.widths);
      lefts.set(next.lefts);
      sideMasks.set(next.sideMasks);
      leaveMasks.set(next.leaveMasks);
      destructiveMasks.set(next.destructiveMasks);
      if (phase.get() !== 1 && phase.get() !== 2) return;
      const at = next.ids.indexOf(trackId.get());
      if (at >= 0) {
        trackIndex.set(at);
        return;
      }
      trackIndex.set(-1);
      const owned = phase.get() === 2;
      phase.set(0);
      crossed.set(false);
      if (owned) settleTo("closed", trackId.get(), 0);
      GestureStateManager.fail(handlerTag.get());
    };

    /** Swaps the published rows. `fresh` says they are known to match the list as drawn. */
    const replaceRows = (rows: readonly SwipeRow[], fresh: boolean) => {
      rowsById.current = new Map(rows.map((row) => [row.id, row]));
      const erases = (row: SwipeRow) =>
        (row.actions.start && isDestructiveAction(row.actions.start) ? 1 : 0) |
        (row.actions.end && isDestructiveAction(row.actions.end) ? 2 : 0);
      const bits = (row: SwipeRow, leaves: boolean) =>
        (row.actions.start && (!leaves || actionLeavesList(row.actions.start))
          ? 1
          : 0) |
        (row.actions.end && (!leaves || actionLeavesList(row.actions.end))
          ? 2
          : 0);
      // Swapped in one go on the UI thread, so a touch callback never sees some arrays new and
      // others old, and a swipe under way finds its row again in the new order (`adoptRows`).
      runOnUI(adoptRows)({
        ids: rows.map((row) => row.id),
        tops: rows.map((row) => row.top),
        bottoms: rows.map((row) => row.bottom),
        widths: rows.map((row) => row.width),
        lefts: rows.map((row) => row.left ?? 0),
        sideMasks: rows.map((row) => bits(row, false)),
        leaveMasks: rows.map((row) => bits(row, true)),
        destructiveMasks: rows.map(erases),
      });
      staleMirror.current = !fresh;
      stale.set(!fresh);
      // A row that left the list (a filter hid it, the month changed) takes its open state with it.
      const open = openId.current;
      if (open !== null && !rows.some((row) => row.id === open))
        runOnUI(startClosing)();
    };

    return {
      enabled,
      gesture,
      activeId,
      activeX,
      closingId,
      closingX,
      committingId,
      committingX,
      confirmingId,
      revealWidth: ROW_REVEAL_WIDTH,
      isRtl,
      publish(rows: readonly SwipeRow[]) {
        replaceRows(rows, true);
      },
      clear() {
        replaceRows([], false);
      },
      setScrollOffset(y: number) {
        scrollOffset.set(y);
        // Rows scroll into the render window as the list moves, and are not published until it
        // is measured again.
        if (y !== lastScrollY.current) {
          lastScrollY.current = y;
          if (!staleMirror.current) {
            staleMirror.current = true;
            stale.set(true);
          }
        }
      },
      markStale() {
        if (staleMirror.current) return;
        staleMirror.current = true;
        stale.set(true);
      },
      setMeasurer(measure: (() => Promise<unknown>) | null) {
        measurer.current = measure;
      },
      suspend(reason: string, on: boolean) {
        if (on) reasons.current.add(reason);
        else reasons.current.delete(reason);
        suspended.set(reasons.current.size > 0);
      },
      close() {
        runOnUI(startClosing)();
      },
      shouldSwallowPress(id: string) {
        return tapClosed.current || openId.current === id;
      },
      release: releaseRow,
      commit(id: string, side: RowSwipeSide) {
        const row = rowsById.current.get(id);
        const kind = row?.actions[side];
        if (!row || !kind) return;
        const width = row.width;
        // Decided here on JS: `actionLeavesList` is not a worklet.
        const leaves = actionLeavesList(kind);
        runOnUI(() => {
          "worklet";
          // Only the open row has a button to press, and a row whose action is already taken
          // (sliding away, or settling shut) takes no second one.
          if (
            activeId.get() !== id ||
            committingId.get() === id ||
            lockedId.get() === id
          )
            return;
          runCommit(id, side, leaves, width, 0);
        })();
      },
    } satisfies RowSwipeController;
    // The worklets close over exactly the values listed here; the shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isRtl, instant, travel, spring, quick, hold, windowWidth]);

  return controller;
}

/** The screen's row swipe, for the lists and rows below it. Null where there is none. */
export const RowSwipeContext = createContext<RowSwipeController | null>(null);

export function useRowSwipeController(): RowSwipeController | null {
  return use(RowSwipeContext);
}

/** Closes the open row when `condition` turns true (a month change, selection mode, a scroll). */
export function useCloseRowSwipeWhen(
  controller: RowSwipeController | null,
  condition: boolean,
) {
  useEffect(() => {
    if (condition) controller?.close();
  }, [controller, condition]);
}

/**
 * A row that slid away and is back in play (its action was undone, or failed and was unhidden) must
 * return to rest: the swipe holds it off to the side until told otherwise. `hiddenIds` and
 * `pending` are the screen's row-action state; a row that was in either and no longer is gets
 * `release`d.
 */
export function useReleaseReturnedRows(
  controller: Pick<RowSwipeController, "release">,
  hiddenIds: ReadonlySet<string>,
  pending: readonly { id: string }[],
) {
  const engaged = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(hiddenIds);
    for (const action of pending) now.add(action.id);
    for (const id of engaged.current) if (!now.has(id)) controller.release(id);
    engaged.current = now;
  }, [controller, hiddenIds, pending]);
}

/** A stable `close` for event handlers. */
export function useRowSwipeClose(controller: RowSwipeController | null) {
  return useCallback(() => controller?.close(), [controller]);
}
