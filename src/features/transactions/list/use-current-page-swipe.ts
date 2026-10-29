import { useEffect, type RefObject } from "react";

import type { RowGeometry } from "@/features/transactions/list/row-swipe/use-row-geometry";
import type { RowSwipeController } from "@/features/transactions/list/row-swipe/use-row-swipe";

/**
 * Hands the row swipe to a month page while it is the current one, and takes it back when it is
 * not. The swipe is one object for the screen, so it knows nothing about which page's rows it holds
 * until the page says: its measuring, and the scroll offset its rows are hit-tested against. The
 * offset is the part that goes stale. It was last written by the previous page's scroll events, and
 * a page that has just become current may sit somewhere else (the old page scrolled 800dp, this
 * one is at the top), so it is set from this page's own offset before the first touch can use it.
 */
export function useCurrentPageSwipe({
  isCurrent,
  rowSwipe,
  geometry,
  scrollOffset,
}: {
  isCurrent: boolean;
  rowSwipe: RowSwipeController | null;
  geometry: Pick<RowGeometry, "measure">;
  /** This page's own last reported scroll offset. */
  scrollOffset: RefObject<number>;
}) {
  useEffect(() => {
    if (!isCurrent || !rowSwipe) return;
    // Before the measurement: whatever it publishes is in content space for this offset.
    rowSwipe.setScrollOffset(scrollOffset.current);
    void geometry.measure();
    // A touch that lands where no row is published measures the mounted rows before deciding.
    rowSwipe.setMeasurer(geometry.measure);
    return () => {
      rowSwipe.setMeasurer(null);
      // Not `publish([])`: that would say an empty list is the right one, and a touch that misses
      // the rows must stay undecided until the next page's rows are measured.
      rowSwipe.clear();
      rowSwipe.close();
    };
  }, [isCurrent, rowSwipe, geometry, scrollOffset]);
}
