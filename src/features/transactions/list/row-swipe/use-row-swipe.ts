/* eslint-disable react-hooks/refs -- the gesture and its worklets run later, off the render path; they only read shared values and refs */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Gesture, PointerType } from "react-native-gesture-handler";
import {
  cancelAnimation,
  runOnJS,
  runOnUI,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useMotionPreference } from "@/components/ui/motion";
import {
  actionLeavesList,
  type RowSwipeActionKind,
  type RowSwipeActions,
} from "@/features/transactions/list/row-swipe/row-swipe-actions";
import {
  ROW_REVEAL_WIDTH,
  commitOffset,
  displayOffset,
  findRowAt,
  isPastCommitLine,
  resolveRowSwipe,
  settleOffset,
  type RowSwipeSide,
} from "@/features/transactions/list/row-swipe/resolve-row-swipe";
import { hapticImpactLight } from "@/services/haptics";
import { useQashyTheme } from "@/theme/theme";

const WEB = process.env.EXPO_OS === "web";
/** Touches this close to a screen edge are left to the system back gesture, like the month pager. */
const EDGE_GUARD = 24;
/** The finger must travel this far sideways before the swipe takes the touch... */
const ACTIVATE_X = 16;
/** ...and fails the moment it travels this far vertically first, which is a scroll. */
const FAIL_Y = 10;
/** After a touch that closed an open row, how long a press it produces is still swallowed. */
const TAP_GRACE_MS = 150;
/** A committed row that is still listed this long afterwards (the action did not remove it) comes back. */
const RETURN_AFTER_MS = 700;

/** One mounted row as the swipe needs to know it: where it is and what each side does. */
export interface SwipeRow {
  id: string;
  /** Content-space edges (see `RowRect`). */
  top: number;
  bottom: number;
  width: number;
  actions: RowSwipeActions;
}

export interface RowSwipeOptions {
  /** The device setting, `swipeRowActions`. */
  enabled: boolean;
  isRtl: boolean;
  /** A swipe committed (or a revealed action was pressed): do `kind` to the row. */
  onAction: (id: string, kind: RowSwipeActionKind) => void;
}

/**
 * The one swipe gesture for a screen's transaction lists (not one per row), plus the shared state
 * the rows draw from. The screen creates it so the same gesture object can be handed to the month
 * pager as `blockedBy` and attached to the current page's list.
 *
 * Everything per touch runs on the UI thread. The list publishes the mounted rows' positions
 * (`publish`) and its scroll offset; a touch-down hit-tests them and fails at once when no row is
 * under the finger, so the pager's month swipe waits for nothing in headers or empty space. On a
 * row, the touch becomes a swipe past 16dp sideways and fails past 10dp vertically (a scroll).
 *
 * Only one row is ever open or being dragged: `activeId`/`activeX` describe it, `closingId`/
 * `closingX` the one that is still sliding shut. A row reads its own offset from them
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
  revealWidth: number;
  isRtl: boolean;
  /** Replaces the mounted rows. Call after each geometry pass or when the actions change. */
  publish(rows: readonly SwipeRow[]): void;
  /** The list's scroll offset, for hit-testing against content-space rows. */
  setScrollOffset(y: number): void;
  /** Stops the gesture from starting (selection mode, a drag-select) while any reason is on. */
  suspend(reason: string, on: boolean): void;
  /** Slides the open row shut. */
  close(): void;
  /** A press that should close an open row instead of opening it. */
  shouldSwallowPress(id: string): boolean;
  /** A revealed action was pressed: take the action as a full swipe would. */
  commit(id: string, side: RowSwipeSide): void;
}

export function useRowSwipe({
  enabled,
  isRtl,
  onAction,
}: RowSwipeOptions): RowSwipeController {
  const { motion } = useQashyTheme();
  const { instant, travel } = useMotionPreference();
  const spring = motion.spring.snappy;
  const quick = motion.duration.fast;

  const ids = useSharedValue<string[]>([]);
  const tops = useSharedValue<number[]>([]);
  const bottoms = useSharedValue<number[]>([]);
  const widths = useSharedValue<number[]>([]);
  // Bit 0: the start side has an action. Bit 1: the end side has one.
  const sideMasks = useSharedValue<number[]>([]);
  // The same bits, for actions that take the row out of the list.
  const leaveMasks = useSharedValue<number[]>([]);
  const scrollOffset = useSharedValue(0);
  const suspended = useSharedValue(false);

  const activeId = useSharedValue("");
  const activeX = useSharedValue(0);
  const closingId = useSharedValue("");
  const closingX = useSharedValue(0);

  // 0 idle, 1 a finger is on a row and has not decided, 2 the swipe owns the touch.
  const phase = useSharedValue(0);
  const trackId = useSharedValue("");
  const trackIndex = useSharedValue(-1);
  const startOffset = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const crossed = useSharedValue(false);

  const rowsById = useRef(new Map<string, SwipeRow>());
  const latest = useRef({ onAction });
  useEffect(() => {
    latest.current = { onAction };
  });
  const reasons = useRef(new Set<string>());
  /** The row that rests open, as far as JS needs to know (to swallow its content's press). */
  const openId = useRef<string | null>(null);
  const tapClosed = useRef(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      clearTimeout(tapTimer.current);
      clearTimeout(returnTimer.current);
    },
    [],
  );

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
    ) => {
      "worklet";
      if (instant) {
        cancelAnimation(target);
        target.set(to);
        if (done) done(true);
        return;
      }
      if (!travel) {
        target.set(withTiming(to, { duration: quick }, done));
        return;
      }
      target.set(
        withSpring(to, { ...spring, velocity, overshootClamping: true }, done),
      );
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
        if (finished && closingId.get() === id) closingId.set("");
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
        },
      );
      runOnJS(setOpen)(settle === "closed" ? null : id);
    };

    const handleCommit = (id: string, side: RowSwipeSide) => {
      const kind = rowsById.current.get(id)?.actions[side];
      if (!kind) return;
      latest.current.onAction(id, kind);
      if (actionLeavesList(kind)) {
        // The row is on its way out. If the action never removes it (it was refused), bring it back.
        clearTimeout(returnTimer.current);
        returnTimer.current = setTimeout(() => {
          runOnUI(() => {
            "worklet";
            if (activeId.get() !== id) return;
            animate(activeX, 0, 0, (finished) => {
              "worklet";
              if (finished && activeId.get() === id) activeId.set("");
            });
          })();
        }, RETURN_AFTER_MS);
      }
    };

    /** A release (or a pressed action) that commits `side` of row `id`. */
    const runCommit = (
      id: string,
      side: RowSwipeSide,
      leaves: boolean,
      width: number,
      velocity: number,
    ) => {
      "worklet";
      activeId.set(id);
      if (leaves) {
        animate(
          activeX,
          commitOffset(side, width, isRtl),
          velocity,
          (finished) => {
            "worklet";
            if (finished) runOnJS(handleCommit)(id, side);
          },
        );
        runOnJS(setOpen)(null);
        return;
      }
      runOnJS(handleCommit)(id, side);
      settleTo("closed", id, velocity);
    };

    const gesture = Gesture.Pan()
      .enabled(enabled)
      .hitSlop({ left: -EDGE_GUARD, right: -EDGE_GUARD })
      // Manual activation on both platforms: the touch-down decides whether this gesture exists
      // at all, and the thresholds are applied by hand, as the pager does on the web.
      .manualActivation(true)
      .onTouchesDown((event, manager) => {
        "worklet";
        const touch = event.allTouches[0];
        if (
          !touch ||
          event.allTouches.length > 1 ||
          suspended.get() ||
          (WEB && event.pointerType !== PointerType.TOUCH)
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
        // A touch anywhere but on the open row closes it.
        if (activeId.get() !== "" && activeId.get() !== id) {
          startClosing();
          runOnJS(noteTapClosed)();
        }
        if (index < 0 || sideMasks.get()[index] === 0) {
          phase.set(0);
          manager.fail();
          return;
        }
        // Catch a row that is still sliding, wherever it is.
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
        touchX.set(touch.absoluteX);
        touchY.set(touch.absoluteY);
      })
      .onTouchesMove((event, manager) => {
        "worklet";
        if (phase.get() !== 1) return;
        const touch = event.allTouches[0];
        if (!touch) return;
        if (suspended.get()) {
          phase.set(0);
          manager.fail();
          return;
        }
        const dx = touch.absoluteX - touchX.get();
        const dy = touch.absoluteY - touchY.get();
        if (Math.abs(dy) > FAIL_Y) {
          phase.set(0);
          manager.fail();
        } else if (Math.abs(dx) >= ACTIVATE_X) {
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
        const release = success
          ? resolveRowSwipe({
              offset: activeX.get(),
              velocity: event.velocityX,
              rowWidth: width,
              revealWidth: ROW_REVEAL_WIDTH,
              isRtl,
              sides: { start: (mask & 1) !== 0, end: (mask & 2) !== 0 },
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
        if (phase.get() === 2) {
          phase.set(0);
          crossed.set(false);
          settleTo("closed", trackId.get(), 0);
        }
        phase.set(0);
        runOnJS(releaseTap)();
      });

    return {
      enabled,
      gesture,
      activeId,
      activeX,
      closingId,
      closingX,
      revealWidth: ROW_REVEAL_WIDTH,
      isRtl,
      publish(rows: readonly SwipeRow[]) {
        rowsById.current = new Map(rows.map((row) => [row.id, row]));
        const bits = (row: SwipeRow, leaves: boolean) =>
          (row.actions.start && (!leaves || actionLeavesList(row.actions.start))
            ? 1
            : 0) |
          (row.actions.end && (!leaves || actionLeavesList(row.actions.end))
            ? 2
            : 0);
        ids.set(rows.map((row) => row.id));
        tops.set(rows.map((row) => row.top));
        bottoms.set(rows.map((row) => row.bottom));
        widths.set(rows.map((row) => row.width));
        sideMasks.set(rows.map((row) => bits(row, false)));
        leaveMasks.set(rows.map((row) => bits(row, true)));
      },
      setScrollOffset(y: number) {
        scrollOffset.set(y);
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
      commit(id: string, side: RowSwipeSide) {
        const row = rowsById.current.get(id);
        const kind = row?.actions[side];
        if (!row || !kind) return;
        const width = row.width;
        runOnUI(() => {
          "worklet";
          runCommit(id, side, actionLeavesList(kind), width, 0);
        })();
      },
    } satisfies RowSwipeController;
    // The worklets close over exactly the values listed here; the shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isRtl, instant, travel, spring, quick]);

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

/** A stable `close` for event handlers. */
export function useRowSwipeClose(controller: RowSwipeController | null) {
  return useCallback(() => controller?.close(), [controller]);
}
