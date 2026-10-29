/**
 * The shared state behind dragging a card to a new position in Overview edit mode.
 *
 * One of these lives in the month page. It owns the geometry every dragged frame needs on the UI
 * thread (each card's slot, the page's scroll offset, the scroll viewport), the live drop target
 * the insertion indicator draws, and the edge auto-scroll: while a card is held near the top or
 * bottom of the viewport the page scrolls beneath the finger, one `scrollTo` per frame.
 *
 * A dragging frame writes `source`, `target` and `autoScroll`; nothing here persists anything.
 * Dropping hands the final index to the screen, which reorders (optimistically) and saves.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
} from "react-native";
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import type { OverviewCard } from "@/domain/overview-layout";
import {
  clampScroll,
  slotsFromHeights,
  type CardSlot,
} from "@/features/overview/edit/drag-math";

/** The scroll viewport in window coordinates, measured when a drag starts. */
export interface DragViewport {
  readonly top: number;
  readonly height: number;
}

export interface CardReorder {
  /** Every card's slot, in the cards' current order. */
  readonly slots: SharedValue<readonly CardSlot[]>;
  /** The page's scroll offset. Frozen while a drag is live, where `scrollBy` owns it. */
  readonly scrollY: SharedValue<number>;
  /** Index of the card being dragged, or -1. */
  readonly source: SharedValue<number>;
  /** Index the card would take if dropped now, or -1. */
  readonly target: SharedValue<number>;
  /** Signed scroll step per 16ms frame requested by the finger's position, 0 when idle. */
  readonly autoScroll: SharedValue<number>;
  readonly viewport: SharedValue<DragViewport>;
  /** The gap between cards, for the insertion line. */
  readonly gap: number;
  /** Reports a card's laid-out height. */
  readonly setCardHeight: (id: string, height: number) => void;
  /** A drag began or ended: pauses the page's own scrolling and starts or stops auto-scroll. */
  readonly setDragging: (dragging: boolean) => void;
}

export function useCardReorder({
  cards,
  gap,
  scrollRef,
}: {
  cards: readonly OverviewCard[];
  gap: number;
  scrollRef: RefObject<ScrollViewInstance | null>;
}) {
  const slots = useSharedValue<readonly CardSlot[]>([]);
  const scrollY = useSharedValue(0);
  const source = useSharedValue(-1);
  const target = useSharedValue(-1);
  const autoScroll = useSharedValue(0);
  const viewport = useSharedValue<DragViewport>({ top: 0, height: 0 });
  const [dragging, setDraggingState] = useState(false);

  const heights = useRef(new Map<string, number>());
  const cardsRef = useRef(cards);
  const metrics = useRef({ scrollY: 0, content: 0, viewport: 0 });
  const draggingRef = useRef(false);

  const publish = useCallback(() => {
    const ordered: number[] = [];
    for (const card of cardsRef.current) {
      const height = heights.current.get(card.id);
      // Until every card has reported, the slots would be wrong; keep the last good ones.
      if (height === undefined) return;
      ordered.push(height);
    }
    slots.set(slotsFromHeights(ordered, gap));
  }, [slots, gap]);

  useLayoutEffect(() => {
    cardsRef.current = cards;
    publish();
  }, [cards, publish]);

  const setCardHeight = useCallback(
    (id: string, height: number) => {
      if (heights.current.get(id) === height) return;
      heights.current.set(id, height);
      publish();
    },
    [publish],
  );

  const scrollBy = useCallback(
    (step: number) => {
      const state = metrics.current;
      const next = clampScroll(
        state.scrollY + step,
        Math.max(0, state.content - state.viewport),
      );
      if (next === state.scrollY) return;
      state.scrollY = next;
      // Moved here at once rather than waiting for the scroll event, so the dragged card keeps
      // pace with the content scrolling beneath the finger.
      scrollY.set(next);
      scrollRef.current?.scrollTo({ y: next, animated: false });
    },
    [scrollRef, scrollY],
  );

  const frame = useFrameCallback((info) => {
    "worklet";
    const step = autoScroll.get();
    if (step === 0) return;
    // Steps are per 16ms; a faster display frame scrolls proportionally less.
    const elapsed = Math.min(info.timeSincePreviousFrame ?? 16, 48);
    runOnJS(scrollBy)((step * elapsed) / 16);
  }, false);

  useEffect(() => {
    frame.setActive(dragging);
  }, [dragging, frame]);

  const setDragging = useCallback(
    (next: boolean) => {
      draggingRef.current = next;
      setDraggingState(next);
      if (next) {
        scrollRef.current?.measureInWindow((_x, top, _width, height) => {
          viewport.set({ top, height });
        });
      } else {
        autoScroll.set(0);
        source.set(-1);
        target.set(-1);
      }
    },
    [autoScroll, scrollRef, source, target, viewport],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      metrics.current.scrollY = offset;
      // While dragging, `scrollBy` is the source of truth; a stale event must not pull the
      // dragged card back.
      if (!draggingRef.current) scrollY.set(offset);
    },
    [scrollY],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    metrics.current.viewport = event.nativeEvent.layout.height;
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    metrics.current.content = height;
  }, []);

  const reorder: CardReorder = {
    slots,
    scrollY,
    source,
    target,
    autoScroll,
    viewport,
    gap,
    setCardHeight,
    setDragging,
  };

  return {
    reorder,
    dragging,
    scrollProps: { onScroll, onLayout, onContentSizeChange },
  };
}
