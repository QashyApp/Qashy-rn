/**
 * The shared state behind dragging a card to a new position in Overview edit mode.
 *
 * One of these lives in the month page. It owns the geometry every dragged frame needs on the UI
 * thread (each card's slot, the page's scroll offset, the scroll viewport), the live drop target
 * the insertion indicator draws, and the edge auto-scroll: while a card is held near the top or
 * bottom of the viewport the page scrolls beneath the finger, one `scrollTo` per frame. The
 * scrolling runs on the UI thread, in the same frame callback that advances `scrollY`, so the
 * held card and the content under it never skew.
 *
 * A dragging frame writes `source`, `target` and `autoScroll`; nothing here persists anything.
 * Dropping hands the final index to the screen, which reorders (optimistically) and saves.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
} from "react-native";
import {
  scrollTo,
  useAnimatedRef,
  useFrameCallback,
  useSharedValue,
  type AnimatedRef,
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
  /** The page's scroll offset. While a drag is live the auto-scroll frame callback owns it. */
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
}: {
  cards: readonly OverviewCard[];
  gap: number;
}) {
  // Attach to the page's scroll view (`Animated.ScrollView`): the UI thread scrolls it by this.
  const scrollRef: AnimatedRef<ScrollViewInstance> =
    useAnimatedRef<ScrollViewInstance>();
  const slots = useSharedValue<readonly CardSlot[]>([]);
  const scrollY = useSharedValue(0);
  const source = useSharedValue(-1);
  const target = useSharedValue(-1);
  const autoScroll = useSharedValue(0);
  const viewport = useSharedValue<DragViewport>({ top: 0, height: 0 });
  // The scroll view's own size and its content's, for clamping the auto-scroll on the UI thread.
  const layoutHeight = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const [dragging, setDraggingState] = useState(false);

  const heights = useRef(new Map<string, number>());
  const cardsRef = useRef(cards);
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

  const frame = useFrameCallback((info) => {
    "worklet";
    // A step queued as the finger lifts must not scroll the page after the release.
    if (source.get() < 0) return;
    const step = autoScroll.get();
    if (step === 0) return;
    // Steps are per 16ms; a faster display frame scrolls proportionally less.
    const elapsed = Math.min(info.timeSincePreviousFrame ?? 16, 48);
    const current = scrollY.get();
    const next = clampScroll(
      current + (step * elapsed) / 16,
      Math.max(0, contentHeight.get() - layoutHeight.get()),
    );
    if (next === current) return;
    // The held card reads `scrollY` in the same frame, so it keeps pace with the content.
    scrollY.set(next);
    scrollTo(scrollRef, 0, next, false);
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
      // While dragging, the auto-scroll frame callback is the source of truth; a late event must
      // not pull the dragged card back. Afterwards events reconcile.
      if (draggingRef.current) return;
      scrollY.set(event.nativeEvent.contentOffset.y);
    },
    [scrollY],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      layoutHeight.set(event.nativeEvent.layout.height);
    },
    [layoutHeight],
  );

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.set(height);
    },
    [contentHeight],
  );

  // Stable, so the memoised month page and every frame only re-render for what they use.
  const reorder = useMemo<CardReorder>(
    () => ({
      slots,
      scrollY,
      source,
      target,
      autoScroll,
      viewport,
      gap,
      setCardHeight,
      setDragging,
    }),
    [
      slots,
      scrollY,
      source,
      target,
      autoScroll,
      viewport,
      gap,
      setCardHeight,
      setDragging,
    ],
  );
  const scrollProps = useMemo(
    () => ({ onScroll, onLayout, onContentSizeChange }),
    [onScroll, onLayout, onContentSizeChange],
  );

  return { reorder, dragging, scrollProps, scrollRef };
}
