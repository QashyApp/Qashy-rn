import { useEffect, useRef, useState } from "react";
import type { HostInstance } from "react-native";

import { findRowAt } from "@/features/transactions/list/row-swipe/resolve-row-swipe";

/**
 * Where one mounted row sits, in the list's content space: `top` and `bottom` are window
 * coordinates plus the scroll offset at the time of measuring, so they stay valid while the list
 * scrolls. `width` is the row's drawn width.
 */
export interface RowRect {
  id: string;
  top: number;
  bottom: number;
  width: number;
}

export interface RowGeometry {
  /** Ref callback target: the row's view while mounted, null when it goes. */
  register(id: string, node: HostInstance | null): void;
  /** Measures every registered row once. Overlapping calls share one pass. */
  measure(): Promise<readonly RowRect[]>;
  /**
   * The row under a window y coordinate, found by measuring the mounted rows now, with its window
   * `top`/`bottom` as measured. Both sides are in window space, so no scroll offset is involved and
   * nothing is cached: right even mid-scroll. A caller that applies the result later checks that its
   * finger is still within that range.
   */
  measureAt(
    windowY: number,
  ): Promise<{ id: string; top: number; bottom: number } | null>;
  /**
   * The layout may have changed (rows came, went or moved): measure again shortly, once the list
   * has stopped scrolling.
   */
  invalidate(): void;
  /** The list scrolled. Automatic measuring waits until scroll events have stopped for a moment. */
  noteScroll(): void;
  /** The row under a window y coordinate, from the cache, or null in a gap. */
  find(windowY: number): string | null;
  /** The last measured rows, sorted top to bottom. */
  rects(): readonly RowRect[];
}

/** Rows registering together (a list rendering a screenful) collapse into one measuring pass. */
const SETTLE_MS = 80;
/** A measure whose callbacks never all arrive (a row left mid-pass) still resolves. */
const GIVE_UP_MS = 300;
/**
 * A list that scrolled this recently is still moving (a fling reports its offset to JS late), so a
 * measurement now would pair a window position with a stale scroll offset and file the row at the
 * wrong place in content space.
 */
const SCROLL_QUIET_MS = 120;

/**
 * One cache of row positions, shared by everything on the list that needs to know which row a
 * finger is over: drag-select and the row swipe. Rows are measured when they mount, move or the
 * list stops scrolling, never on each touch move.
 *
 * The cache is in content space (see `RowRect`), so scrolling does not invalidate it; only rows
 * that are not in it yet (newly mounted ones) are missing until the next pass. That pass waits for
 * the list to come to rest (`noteScroll`), so a row is never filed from a lagging offset; until then
 * a touch on it finds no row rather than its neighbour. An explicit `measure()` does not wait.
 */
export function useRowGeometry({
  getScrollOffset,
  onMeasured,
}: {
  /** The list's current scroll offset. */
  getScrollOffset: () => number;
  /** Called after every pass, with the rows in the cache. */
  onMeasured?: (rects: readonly RowRect[]) => void;
}): RowGeometry {
  const latest = useRef({ getScrollOffset, onMeasured });
  useEffect(() => {
    latest.current = { getScrollOffset, onMeasured };
  });

  // One object for the life of the list; everything it touches is behind refs.
  const [geometry] = useState(() => {
    const nodes = new Map<string, HostInstance>();
    let cache: RowRect[] = [];
    let tops: number[] = [];
    let bottoms: number[] = [];
    let inFlight: Promise<readonly RowRect[]> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastScrollAt = Number.NEGATIVE_INFINITY;
    let disposed = false;

    /** Every mounted row's window position, as the platform reports it. */
    const measureWindow = () =>
      new Promise<RowRect[]>((resolve) => {
        const entries = [...nodes];
        if (entries.length === 0) {
          resolve([]);
          return;
        }
        const found: RowRect[] = [];
        let pending = entries.length;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(giveUp);
          found.sort((a, b) => a.top - b.top);
          resolve(found);
        };
        const giveUp = setTimeout(finish, GIVE_UP_MS);
        for (const [id, node] of entries) {
          node.measureInWindow((_x, top, width, height) => {
            if (height > 0 && Number.isFinite(top))
              found.push({ id, top, bottom: top + height, width });
            pending -= 1;
            if (pending === 0) finish();
          });
        }
      });

    const measure = (): Promise<readonly RowRect[]> => {
      if (inFlight) return inFlight;
      clearTimeout(settleTimer);
      settleTimer = undefined;
      const pass = measureWindow()
        .then((windowRects) => {
          const offset = latest.current.getScrollOffset();
          return windowRects.map((rect) => ({
            ...rect,
            top: rect.top + offset,
            bottom: rect.bottom + offset,
          }));
        })
        .then((rects) => {
          inFlight = null;
          if (disposed) return rects;
          cache = rects as RowRect[];
          tops = cache.map((rect) => rect.top);
          bottoms = cache.map((rect) => rect.bottom);
          latest.current.onMeasured?.(cache);
          return rects;
        });
      inFlight = pass;
      return pass;
    };

    const schedule = (delay: number) => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        if (disposed) return;
        const sinceScroll = Date.now() - lastScrollAt;
        if (sinceScroll < SCROLL_QUIET_MS) {
          // Still scrolling: try again once it has been quiet long enough.
          schedule(SCROLL_QUIET_MS - sinceScroll);
          return;
        }
        void measure();
      }, delay);
    };

    const invalidate = () => {
      if (disposed) return;
      schedule(SETTLE_MS);
    };

    return {
      geometry: {
        register(id, node) {
          if (node) nodes.set(id, node);
          else nodes.delete(id);
          invalidate();
        },
        measure,
        async measureAt(windowY) {
          const rects = await measureWindow();
          const hit = rects.find(
            (rect) => windowY >= rect.top && windowY < rect.bottom,
          );
          return hit ? { id: hit.id, top: hit.top, bottom: hit.bottom } : null;
        },
        invalidate,
        noteScroll() {
          lastScrollAt = Date.now();
        },
        find(windowY) {
          const index = findRowAt(
            tops,
            bottoms,
            windowY + latest.current.getScrollOffset(),
          );
          return index < 0 ? null : cache[index].id;
        },
        rects: () => cache,
      } satisfies RowGeometry,
      /** Marks the cache live again: a strict-mode remount runs the cleanup first, then the effect. */
      revive() {
        disposed = false;
      },
      dispose() {
        disposed = true;
        clearTimeout(settleTimer);
      },
    };
  });

  useEffect(() => {
    geometry.revive();
    return () => geometry.dispose();
  }, [geometry]);
  return geometry.geometry;
}
