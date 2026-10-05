/* eslint-disable react-hooks/refs -- the gesture builder runs its handlers later, off the render path; they only touch refs */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { View } from "react-native";
import { Gesture } from "react-native-gesture-handler";

import { hapticSelection } from "@/utils/haptics";

/** How close to the list's top or bottom edge the finger scrolls it, and how far per tick. */
const EDGE_ZONE = 72;
/** The fastest scroll per tick, reached at the very edge; it eases in from the edge of the zone. */
const SCROLL_STEP = 14;
/** The finger must have travelled this far from where it was held before the edges scroll. */
const MIN_TRAVEL = 24;
/** How far a finger may drift while held, waiting for the long-press, before it counts as a scroll. */
const HOLD_SLOP = 10;
const TICK_MS = 16;

/**
 * Press a row, hold, then drag to select every row between it and the finger.
 *
 * The hold is the row's own long-press (`arm`), which is also what enters selection mode. Moving the
 * finger afterwards activates this pan instead of scrolling the list; moving it before the hold
 * fires fails the pan, so ordinary scrolling is untouched. The selection is the held row plus the
 * range from it to the row under the finger, so dragging back shrinks it again. Near the top or
 * bottom of the list it scrolls itself, to reach rows that are not on screen.
 *
 * The list is virtualised, so rows are found by measuring the ones that are mounted (`registerRow`).
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
  scrollBy,
}: {
  enabled: boolean;
  /** Every selectable row, in display order. */
  orderedIds: readonly string[];
  selectedIds: readonly string[];
  onSelect: (ids: string[]) => void;
  /** The list's own box, for the scroll edges. */
  containerRef: RefObject<View | null>;
  scrollBy: (delta: number) => void;
}) {
  const rows = useRef(new Map<string, View>());
  const armed = useRef<{ anchor: string; base: string[]; last: string } | null>(
    null,
  );
  const latest = useRef({ orderedIds, selectedIds, onSelect, scrollBy });
  useEffect(() => {
    latest.current = { orderedIds, selectedIds, onSelect, scrollBy };
  }, [orderedIds, selectedIds, onSelect, scrollBy]);
  const [dragging, setDragging] = useState(false);
  /** A finger is down on the list and this pan is still following it. */
  const tracking = useRef(false);
  const finger = useRef(0);
  const fingerStart = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const bounds = useRef<{ top: number; bottom: number } | null>(null);
  const measuring = useRef(false);
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
    if (measuring.current || rows.current.size === 0) return;
    measuring.current = true;
    const y = finger.current;
    let pending = rows.current.size;
    let hit: string | null = null;
    rows.current.forEach((node, id) => {
      node.measureInWindow((_x, top, _width, height) => {
        if (y >= top && y <= top + height) hit = id;
        pending -= 1;
        if (pending === 0) {
          measuring.current = false;
          if (hit) apply(hit);
        }
      });
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
    const intoTop = edges.top + EDGE_ZONE - y;
    const intoBottom = y - (edges.bottom - EDGE_ZONE);
    if (intoTop > 0)
      latest.current.scrollBy(-SCROLL_STEP * Math.min(1, intoTop / EDGE_ZONE));
    else if (intoBottom > 0)
      latest.current.scrollBy(
        SCROLL_STEP * Math.min(1, intoBottom / EDGE_ZONE),
      );
    else return;
    hitTest();
  };

  // A browser scrolls a touch as soon as it moves, whatever the gesture handler does. Once the hold
  // has armed a drag, cancelling touchmove keeps the list still for it. A browser that has already
  // committed the touch to scrolling cancels the pointer instead, so selected rows also opt out of
  // touch scrolling (`touchAction` in the row), which lets a drag that starts on one always work.
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
    tracking.current = false;
    armed.current = null;
    clearInterval(timer.current);
    timer.current = undefined;
    setDragging(false);
  };

  // On the web a selected row cannot be scrolled (see above), so pressing one grabs it: moving from
  // it extends or shrinks the selection around it, the same drag the hold starts on an unselected row.
  const grabSelected = (y: number) => {
    if (process.env.EXPO_OS !== "web" || armed.current) return;
    const { selectedIds: chosen } = latest.current;
    rows.current.forEach((node, id) => {
      if (!chosen.includes(id)) return;
      node.measureInWindow((_x, top, _width, height) => {
        if (tracking.current && !armed.current && y >= top && y <= top + height)
          armed.current = { anchor: id, base: [...chosen], last: id };
      });
    });
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
          if (touch) grabSelected(touch.absoluteY);
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

  const registerRow = useCallback((id: string, node: View | null) => {
    if (node) rows.current.set(id, node);
    else rows.current.delete(id);
  }, []);
  const arm = useCallback((id: string) => {
    // The long-press can still fire after this pan has given the touch up (the finger drifted
    // past HOLD_SLOP, or the list started scrolling). Arming then would leave a drag waiting for
    // the next, unrelated touch, which would select rows instead of scrolling.
    if (!tracking.current) return;
    setDragging(true);
    armed.current = {
      anchor: id,
      base: [...new Set([...latest.current.selectedIds, id])],
      last: id,
    };
  }, []);

  /** `registerRow` is for each row's view; `arm` is called when a row's long-press fires. */
  return { gesture, registerRow, arm, dragging };
}
