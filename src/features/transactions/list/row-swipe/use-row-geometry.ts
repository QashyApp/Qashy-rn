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
  /** The layout may have changed (rows came, went or moved): measure again shortly. */
  invalidate(): void;
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
 * One cache of row positions, shared by everything on the list that needs to know which row a
 * finger is over: drag-select and the row swipe. Rows are measured when they mount, move or the
 * list stops scrolling, never on each touch move.
 *
 * The cache is in content space (see `RowRect`), so scrolling does not invalidate it; only rows
 * that are not in it yet (newly mounted ones) are missing until the next pass.
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
    let disposed = false;

    const measure = (): Promise<readonly RowRect[]> => {
      if (inFlight) return inFlight;
      clearTimeout(settleTimer);
      settleTimer = undefined;
      const pass = new Promise<readonly RowRect[]>((resolve) => {
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
            if (height > 0 && Number.isFinite(top)) {
              const offset = latest.current.getScrollOffset();
              found.push({
                id,
                top: top + offset,
                bottom: top + offset + height,
                width,
              });
            }
            pending -= 1;
            if (pending === 0) finish();
          });
        }
      }).then((rects) => {
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

    const invalidate = () => {
      if (disposed) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        void measure();
      }, SETTLE_MS);
    };

    return {
      geometry: {
        register(id, node) {
          if (node) nodes.set(id, node);
          else nodes.delete(id);
          invalidate();
        },
        measure,
        invalidate,
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
