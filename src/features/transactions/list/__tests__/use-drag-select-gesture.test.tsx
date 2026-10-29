import { act, renderHook } from "@testing-library/react-native";
import type { HostInstance } from "react-native";

import { useDragSelect } from "@/features/transactions/list/use-drag-select";
import type { RowGeometry } from "@/features/transactions/list/row-swipe/use-row-geometry";

jest.mock("@/services/haptics", () => ({ hapticSelection: jest.fn() }));

/**
 * The drag-select pan's own callbacks. RNGH's jest utilities cannot send touch events, which is
 * what this gesture is driven by, so the tests call the handlers directly.
 */
interface Handlers {
  onTouchesDown(event: unknown): void;
  onTouchesMove(event: unknown, manager: Manager): void;
  onUpdate(event: { absoluteY: number }): void;
  onFinalize(): void;
}
interface Manager {
  fail: jest.Mock;
  activate: jest.Mock;
}

const handlersOf = (gesture: ReturnType<typeof useDragSelect>["gesture"]) =>
  (gesture as unknown as { handlers: Handlers }).handlers;

function fakeGeometry(find: RowGeometry["find"]): RowGeometry {
  return {
    register: jest.fn(),
    measure: jest.fn(async () => []),
    measureAt: jest.fn(async () => null),
    invalidate: jest.fn(),
    settle: jest.fn(),
    noteScroll: jest.fn(),
    find,
    rects: () => [],
  };
}

describe("the drag-select hit test", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // One 16ms frame at a time, whatever the test preset does for animation frames.
    jest
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(
        (callback) =>
          setTimeout(() => callback(Date.now()), 16) as unknown as number,
      );
    jest
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation((handle) => clearTimeout(handle));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("looks for the row at the offset the edge scroll has taken the list to, not the one it last reported", async () => {
    const find = jest.fn<string | null, [number, number | undefined]>(
      () => null,
    );
    const scrollTo = jest.fn();
    const container = {
      current: {
        measureInWindow: (
          cb: (x: number, y: number, w: number, h: number) => void,
        ) => cb(0, 100, 300, 600),
      } as unknown as HostInstance,
    };
    const { result } = await renderHook(() =>
      useDragSelect({
        enabled: true,
        orderedIds: ["a", "b"],
        selectedIds: new Set<string>(),
        onSelect: jest.fn(),
        containerRef: container,
        scrollTo,
        // The list reports its offset late.
        getScrollOffset: () => 200,
        geometry: fakeGeometry(find),
      }),
    );
    const handlers = handlersOf(result.current.gesture);
    handlers.onTouchesDown({
      allTouches: [{ absoluteX: 50, absoluteY: 300 }],
      pointerType: 0,
    });
    await act(() => {
      result.current.arm("a");
    });
    await act(() => {
      handlers.onUpdate({ absoluteY: 300 });
    });
    // The first hit test, before any edge scroll, uses the reported offset.
    expect(find).toHaveBeenLastCalledWith(300, 200);
    await act(() => {
      handlers.onUpdate({ absoluteY: 120 });
      jest.advanceTimersByTime(20);
    });
    // The finger is in the top edge zone: the list is told to scroll 8dp up from where it reports.
    expect(scrollTo).toHaveBeenLastCalledWith(192);
    // Still reporting 200, but the rows are looked for where the scroll put them.
    expect(find).toHaveBeenLastCalledWith(120, 192);
  });

  async function armedDrag(scrollTo: jest.Mock) {
    const container = {
      current: {
        measureInWindow: (
          cb: (x: number, y: number, w: number, h: number) => void,
        ) => cb(0, 100, 300, 600),
      } as unknown as HostInstance,
    };
    const { result } = await renderHook(() =>
      useDragSelect({
        enabled: true,
        orderedIds: ["a", "b"],
        selectedIds: new Set<string>(),
        onSelect: jest.fn(),
        containerRef: container,
        scrollTo,
        getScrollOffset: () => 200,
        geometry: fakeGeometry(() => null),
      }),
    );
    const handlers = handlersOf(result.current.gesture);
    handlers.onTouchesDown({
      allTouches: [{ absoluteX: 50, absoluteY: 400 }],
      pointerType: 0,
    });
    await act(() => {
      result.current.arm("a");
    });
    await act(() => {
      handlers.onUpdate({ absoluteY: 400 });
    });
    return handlers;
  }

  it("asks for no animation frames while the finger is away from the edges", async () => {
    const scrollTo = jest.fn();
    const handlers = await armedDrag(scrollTo);
    await act(() => {
      handlers.onUpdate({ absoluteY: 450 });
      handlers.onUpdate({ absoluteY: 500 });
      jest.advanceTimersByTime(200);
    });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls once per frame in an edge zone and stops asking when the drag ends", async () => {
    const scrollTo = jest.fn();
    const handlers = await armedDrag(scrollTo);
    await act(() => {
      handlers.onUpdate({ absoluteY: 120 });
      jest.advanceTimersByTime(50);
    });
    // Three 16ms frames in 50ms, 8dp each.
    expect(scrollTo.mock.calls.map((call) => call[0])).toEqual([192, 184, 176]);
    await act(() => {
      handlers.onFinalize();
    });
    expect(cancelAnimationFrame).toHaveBeenCalled();
    scrollTo.mockClear();
    await act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("stops the loop when the finger leaves the zone and starts it again on re-entry", async () => {
    const scrollTo = jest.fn();
    const handlers = await armedDrag(scrollTo);
    await act(() => {
      handlers.onUpdate({ absoluteY: 120 });
      jest.advanceTimersByTime(20);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(() => {
      handlers.onUpdate({ absoluteY: 400 });
      jest.advanceTimersByTime(100);
    });
    // The frame already asked for ran and found the finger outside the zone: no more after it.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(() => {
      handlers.onUpdate({ absoluteY: 110 });
      jest.advanceTimersByTime(20);
    });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
