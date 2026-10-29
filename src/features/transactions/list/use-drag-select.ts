/* eslint-disable react-hooks/refs -- the gesture builder runs its handlers later, off the render path; they only touch refs */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { HostInstance } from "react-native";
import { Gesture, PointerType } from "react-native-gesture-handler";

import type { RowGeometry } from "@/features/transactions/list/row-swipe/use-row-geometry";
import { hapticSelection } from "@/services/haptics";

/** How close to the list's top or bottom edge the finger scrolls it. */
const EDGE_ZONE = 72;
/** The fastest scroll per tick, in dp. A step this small is one a finger can still follow. */
const MAX_SCROLL_STEP = 8;
/** The scroll eases in over this much of the zone, then holds the full step to the very edge. */
const EASE_IN_ZONE = 24;
/**
 * The list reports its offset late, so the scroll keeps its own target. If the list ends up this
 * far from it (it hit its end, or something else moved it), the target is taken from the list again.
 */
const RESYNC_DISTANCE = MAX_SCROLL_STEP * 3;
/** The finger must have travelled this far from where it was held before the edges scroll. */
const MIN_TRAVEL = 24;
/** How far a finger may drift while held, waiting for the long-press, before it counts as a scroll. */
const HOLD_SLOP = 12;
const TICK_MS = 16;
/** A finger over a gap in the cached rows measures again at most this often. */
const REMEASURE_MS = 80;

/**
 * How far the list scrolls this tick for a finger at window `y` over a list spanning `top` to
 * `bottom`: negative toward the top, positive toward the bottom, 0 away from the edges. It eases in
 * over the first `EASE_IN_ZONE` of the edge zone and holds `MAX_SCROLL_STEP` from there to the edge.
 */
export function edgeScrollStep(y: number, top: number, bottom: number): number {
  const intoTop = top + EDGE_ZONE - y;
  const intoBottom = y - (bottom - EDGE_ZONE);
  if (intoTop > 0)
    return -MAX_SCROLL_STEP * Math.min(1, intoTop / EASE_IN_ZONE);
  if (intoBottom > 0)
    return MAX_SCROLL_STEP * Math.min(1, intoBottom / EASE_IN_ZONE);
  return 0;
}

/**
 * Whether pressing an already selected row grabs it for a drag at once, without a hold. Only a mouse
 * on the web does: it has no scroll to give up. A finger scrolls the list from a selected row like
 * from any other, and drags from it after the hold arms.
 */
export function grabsSelectedOnPress(
  pointerType: PointerType | undefined,
  web: boolean,
): boolean {
  return web && pointerType === PointerType.MOUSE;
}

/**
 * Press a row, hold, then drag to select every row between it and the finger.
 *
 * The hold is the row's own long-press (`arm`), which is also what enters selection mode. Moving the
 * finger afterwards activates this pan instead of scrolling the list; moving it before the hold
 * fires fails the pan, so ordinary scrolling is untouched. The selection is the held row plus the
 * range from it to the row under the finger, so dragging back shrinks it again. Near the top or
 * bottom of the list it scrolls itself, to reach rows that are not on screen.
 *
 * The list is virtualised, so rows are found in the shared `RowGeometry` cache of the ones that are
 * mounted. It is measured when the hold arms the drag, and again (throttled) only when the finger
 * is over a row the cache has not seen yet; never on every move or tick.
 *
 * `dragging` is true from the hold until the finger lifts. A native list must stop scrolling for
 * that span (`scrollEnabled`): this pan only activates once JS has seen the move, and by then the
 * native scroll view has already claimed the touch and cancelled the drag.
 */
export function useDragSelect({
  enabled,
  orderedIds,
  selectedIds,
  onSelect,
  containerRef,
  scrollTo,
  getScrollOffset,
  geometry,
  onArmedChange,
}: {
  enabled: boolean;
  /** Every selectable row, in display order. */
  orderedIds: readonly string[];
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: string[]) => void;
  /** The list's own box, for the scroll edges. */
  containerRef: RefObject<HostInstance | null>;
  /** Scrolls the list to an absolute offset, without animation. */
  scrollTo: (offset: number) => void;
  /** The list's last reported offset (it lags a fast scroll). */
  getScrollOffset: () => number;
  /** Where the mounted rows are, shared with the row swipe. */
  geometry: RowGeometry;
  /** A drag is armed or over: other gestures on the list (the row swipe) must stand aside. */
  onArmedChange?: (armed: boolean) => void;
}) {
  const armed = useRef<{ anchor: string; base: string[]; last: string } | null>(
    null,
  );
  const latest = useRef({
    orderedIds,
    selectedIds,
    onSelect,
    scrollTo,
    getScrollOffset,
    geometry,
    onArmedChange,
  });
  useEffect(() => {
    latest.current = {
      orderedIds,
      selectedIds,
      onSelect,
      scrollTo,
      getScrollOffset,
      geometry,
      onArmedChange,
    };
  }, [
    orderedIds,
    selectedIds,
    onSelect,
    scrollTo,
    getScrollOffset,
    geometry,
    onArmedChange,
  ]);
  /** Where the edge scroll has taken the list to, advanced each tick; null until it first scrolls. */
  const targetOffset = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  /** A finger is down on the list and this pan is still following it. */
  const tracking = useRef(false);
  const finger = useRef(0);
  const fingerStart = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const bounds = useRef<{ top: number; bottom: number } | null>(null);
  const measuring = useRef(false);
  const throttled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  const apply = (id: string) => {
    const state = armed.current;
    if (!state || id === state.last) return;
    state.last = id;
    const { orderedIds: order, onSelect: select } = latest.current;
    const from = order.indexOf(state.anchor);
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return;
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    hapticSelection();
    select([...new Set([...state.base, ...range])]);
  };

  const hitTest = () => {
    const rows = latest.current.geometry;
    // The list lags the scroll it was told to make: the rows are where that scroll puts them.
    const hit = rows.find(
      finger.current,
      targetOffset.current ?? latest.current.getScrollOffset(),
    );
    if (hit) {
      apply(hit);
      return;
    }
    // Over a gap, or a row that scrolled into view since the last pass: look again, but not on
    // every move. The lookup is in window space (the list may be scrolling under the finger).
    if (measuring.current || throttled.current) return;
    measuring.current = true;
    throttled.current = true;
    setTimeout(() => {
      throttled.current = false;
    }, REMEASURE_MS);
    void rows.measureAt(finger.current).then((found) => {
      measuring.current = false;
      // The finger may have moved on while the rows were measured; a row it has left is stale.
      const y = finger.current;
      if (found && armed.current && y >= found.top && y < found.bottom)
        apply(found.id);
    });
  };

  const tick = () => {
    const edges = bounds.current;
    if (!edges || !armed.current) return;
    const y = finger.current;
    // Holding a row near an edge must not run the list away before the finger has gone anywhere.
    if (
      fingerStart.current === null ||
      Math.abs(y - fingerStart.current) < MIN_TRAVEL
    )
      return;
    const step = edgeScrollStep(y, edges.top, edges.bottom);
    if (step === 0) {
      targetOffset.current = null;
      return;
    }
    const { scrollTo: scroll, getScrollOffset: current } = latest.current;
    const reported = current();
    let target = targetOffset.current;
    if (target === null || Math.abs(target - reported) > RESYNC_DISTANCE)
      target = reported;
    target = Math.max(0, target + step);
    targetOffset.current = target;
    scroll(target);
    hitTest();
  };

  // A browser scrolls a touch as soon as it moves, whatever the gesture handler does. Once the hold
  // has armed a drag, cancelling touchmove keeps the list still for it. (A finger on a selected
  // row scrolls as normal until its hold arms; only a mouse grabs a selected row, below.)
  useEffect(() => {
    if (process.env.EXPO_OS !== "web" || typeof document === "undefined")
      return;
    const stopScroll = (event: TouchEvent) => {
      if (armed.current && event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", stopScroll, {
      passive: false,
      capture: true,
    });
    return () => document.removeEventListener("touchmove", stopScroll, true);
  }, []);

  const stop = () => {
    targetOffset.current = null;
    tracking.current = false;
    armed.current = null;
    clearInterval(timer.current);
    timer.current = undefined;
    setDragging(false);
    latest.current.onArmedChange?.(false);
  };

  // On the web a mouse pressed on a selected row grabs it: moving from it extends or shrinks the
  // selection around it, the same drag the hold starts on an unselected row. A mouse has no scroll
  // to give up, and no hold. A touch does not: it scrolls the list like any other, and a drag from a
  // selected row starts with the hold, as on an unselected one.
  const grabSelected = (y: number) => {
    if (armed.current) return;
    const { selectedIds: chosen, geometry: rows } = latest.current;
    const id = rows.find(y);
    if (!id || !chosen.has(id)) return;
    armed.current = { anchor: id, base: [...chosen], last: id };
    latest.current.onArmedChange?.(true);
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .runOnJS(true)
        .manualActivation(true)
        .onTouchesDown((event) => {
          // A new touch starts clean: nothing armed by an earlier one may carry over into it.
          tracking.current = true;
          armed.current = null;
          const touch = event.allTouches[0];
          touchStart.current = touch
            ? { x: touch.absoluteX, y: touch.absoluteY }
            : null;
          if (
            touch &&
            grabsSelectedOnPress(
              event.pointerType,
              process.env.EXPO_OS === "web",
            )
          )
            grabSelected(touch.absoluteY);
        })
        .onTouchesMove((event, manager) => {
          if (armed.current) {
            manager.activate();
            const moved = event.allTouches[0];
            if (moved) {
              finger.current = moved.absoluteY;
              hitTest();
            }
            return;
          }
          // A finger always wobbles while it is held down waiting for the long-press; only a real
          // move before the hold is a scroll, and leaves the list alone.
          const touch = event.allTouches[0];
          const origin = touchStart.current;
          if (
            !touch ||
            !origin ||
            Math.hypot(touch.absoluteX - origin.x, touch.absoluteY - origin.y) >
              HOLD_SLOP
          )
            manager.fail();
        })
        .onUpdate((event) => {
          finger.current = event.absoluteY;
          if (fingerStart.current === null)
            fingerStart.current = event.absoluteY;
          if (!bounds.current) {
            containerRef.current?.measureInWindow((_x, top, _w, height) => {
              bounds.current = { top, bottom: top + height };
            });
          }
          if (!timer.current) timer.current = setInterval(tick, TICK_MS);
          hitTest();
        })
        // The pan normally ends through onFinalize; lifting or losing the last finger also ends it,
        // so the list can never be left unable to scroll.
        .onTouchesUp((event) => {
          if (event.allTouches.length <= event.changedTouches.length) stop();
        })
        .onTouchesCancelled(() => stop())
        .onFinalize(() => {
          bounds.current = null;
          fingerStart.current = null;
          stop();
        }),
    // The handlers only read refs, so they stay valid for the life of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, containerRef],
  );

  const arm = useCallback((id: string) => {
    // The long-press can still fire after this pan has given the touch up (the finger drifted
    // past HOLD_SLOP, or the list started scrolling). Arming then would leave a drag waiting for
    // the next, unrelated touch, which would select rows instead of scrolling.
    if (!tracking.current) return;
    setDragging(true);
    latest.current.onArmedChange?.(true);
    // One pass now, so the rows the finger crosses are in the cache before it moves.
    void latest.current.geometry.measure();
    targetOffset.current = null;
    armed.current = {
      anchor: id,
      base: [...new Set([...latest.current.selectedIds, id])],
      last: id,
    };
  }, []);

  /** `arm` is called when a row's long-press fires. */
  return { gesture, arm, dragging };
}
