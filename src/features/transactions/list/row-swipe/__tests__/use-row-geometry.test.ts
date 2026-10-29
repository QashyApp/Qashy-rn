import { act, renderHook } from "@testing-library/react-native";
import type { HostInstance } from "react-native";

import { useRowGeometry } from "@/features/transactions/list/row-swipe/use-row-geometry";

/** A row view whose window position is whatever `window.top` says when it is measured. */
function fakeRow(window: { top: number }, height = 50) {
  const measureInWindow = jest.fn(
    (callback: (x: number, y: number, w: number, h: number) => void) =>
      callback(0, window.top, 300, height),
  );
  return {
    node: { measureInWindow } as unknown as HostInstance,
    measureInWindow,
  };
}

describe("useRowGeometry", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("measures registered rows once the layout settles", async () => {
    const row = fakeRow({ top: 100 });
    const { result } = await renderHook(() =>
      useRowGeometry({ getScrollOffset: () => 40 }),
    );
    await act(() => {
      result.current.register("a", row.node);
    });
    expect(row.measureInWindow).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(row.measureInWindow).toHaveBeenCalledTimes(1);
    expect(result.current.rects()).toEqual([
      { id: "a", top: 140, bottom: 190, width: 300 },
    ]);
  });

  it("does not measure a row that mounted mid-scroll until the list has been quiet", async () => {
    const window = { top: 100 };
    const row = fakeRow(window);
    const { result } = await renderHook(() =>
      useRowGeometry({ getScrollOffset: () => 0 }),
    );
    await act(() => {
      result.current.noteScroll();
      result.current.register("a", row.node);
    });
    // Scroll events keep arriving: the measurement keeps waiting.
    for (let i = 0; i < 5; i += 1) {
      await act(() => {
        jest.advanceTimersByTime(60);
        result.current.noteScroll();
      });
    }
    expect(row.measureInWindow).not.toHaveBeenCalled();
    expect(result.current.rects()).toEqual([]);
    // The list comes to rest: now it is measured.
    await act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(row.measureInWindow).toHaveBeenCalledTimes(1);
    expect(result.current.rects()).toHaveLength(1);
  });

  it("measures on demand even while the list is scrolling", async () => {
    const row = fakeRow({ top: 10 });
    const { result } = await renderHook(() =>
      useRowGeometry({ getScrollOffset: () => 0 }),
    );
    await act(() => {
      result.current.register("a", row.node);
      result.current.noteScroll();
    });
    let rects: readonly unknown[] = [];
    await act(async () => {
      rects = await result.current.measure();
    });
    expect(rects).toHaveLength(1);
  });

  it("finds the row under a window y by measuring, whatever the scroll offset says", async () => {
    const row = fakeRow({ top: 100 });
    // The reported offset lags the real one; a window-space lookup does not use it.
    const { result } = await renderHook(() =>
      useRowGeometry({ getScrollOffset: () => 9999 }),
    );
    await act(() => {
      result.current.register("a", row.node);
      result.current.noteScroll();
    });
    let hit: { id: string; top: number; bottom: number } | null = null;
    let miss: unknown = "unset";
    await act(async () => {
      hit = await result.current.measureAt(120);
      miss = await result.current.measureAt(400);
    });
    expect(hit).toMatchObject({ id: "a", top: 100 });
    expect(hit!.bottom).toBeGreaterThan(120);
    expect(miss).toBeNull();
    expect(result.current.rects()).toEqual([]);
  });
});
