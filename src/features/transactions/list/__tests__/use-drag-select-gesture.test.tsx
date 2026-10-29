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
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

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
});
