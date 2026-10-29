import { act, renderHook } from "@testing-library/react-native";
import { GestureStateManager } from "react-native-gesture-handler";

import {
  useRowSwipe,
  type RowSwipeController,
  type SwipeRow,
} from "@/features/transactions/list/row-swipe/use-row-swipe";
import { useCurrentPageSwipe } from "@/features/transactions/list/use-current-page-swipe";

jest.mock("@/components/ui/motion", () => ({
  useMotionPreference: () => ({ instant: true, travel: false }),
}));

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    motion: {
      spring: { snappy: { damping: 20, stiffness: 200, mass: 1 } },
      duration: { fast: 120, base: 160 },
    },
  }),
}));

interface Manager {
  fail: jest.Mock;
  activate: jest.Mock;
}
interface Handlers {
  onTouchesDown(event: unknown, manager: Manager): void;
}

const FIRST_ROW: SwipeRow = {
  id: "first",
  top: 0,
  bottom: 60,
  width: 300,
  actions: { start: "changeCategory", end: "delete" },
};
const DEEP_ROW: SwipeRow = {
  id: "deep",
  top: 800,
  bottom: 860,
  width: 300,
  actions: { start: "changeCategory", end: "delete" },
};

beforeEach(() => {
  jest.spyOn(GestureStateManager, "fail").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("useCurrentPageSwipe", () => {
  it("gives the swipe the page's own scroll offset before it measures, when the page becomes current", async () => {
    const calls: string[] = [];
    const swipe = {
      setScrollOffset: jest.fn((y: number) => calls.push(`offset ${y}`)),
      setMeasurer: jest.fn(),
      clear: jest.fn(),
      close: jest.fn(),
    } as unknown as RowSwipeController;
    const geometry = {
      measure: jest.fn(async () => {
        calls.push("measure");
        return [];
      }),
    };
    const scrollOffset = { current: 0 };
    const { rerender, unmount } = await renderHook(
      (props: { isCurrent: boolean }) =>
        useCurrentPageSwipe({
          isCurrent: props.isCurrent,
          rowSwipe: swipe,
          geometry,
          scrollOffset,
        }),
      { initialProps: { isCurrent: false } },
    );
    expect(calls).toEqual([]);
    await rerender({ isCurrent: true });
    expect(calls).toEqual(["offset 0", "measure"]);
    expect(swipe.setMeasurer).toHaveBeenLastCalledWith(geometry.measure);

    // Left behind: the swipe lets go of the page's rows.
    await rerender({ isCurrent: false });
    expect(swipe.setMeasurer).toHaveBeenLastCalledWith(null);
    expect(swipe.clear).toHaveBeenCalledTimes(1);
    expect(swipe.close).toHaveBeenCalledTimes(1);

    // Back again after it was scrolled: its own offset, not the other page's.
    scrollOffset.current = 340;
    await rerender({ isCurrent: true });
    expect(calls.slice(-2)).toEqual(["offset 340", "measure"]);
    await unmount();
  });

  it("does nothing for a page that is not current, or without a swipe", async () => {
    const geometry = { measure: jest.fn(async () => []) };
    await renderHook(() =>
      useCurrentPageSwipe({
        isCurrent: true,
        rowSwipe: null,
        geometry,
        scrollOffset: { current: 0 },
      }),
    );
    expect(geometry.measure).not.toHaveBeenCalled();
  });

  it("hit-tests the new page's rows at its own offset, not the previous page's scroll", async () => {
    const { result } = await renderHook(() =>
      useRowSwipe({ enabled: true, isRtl: false, onAction: jest.fn() }),
    );
    const swipe = result.current;
    const handlers = (swipe.gesture as unknown as { handlers: Handlers })
      .handlers;

    // The month that was current was scrolled to 800dp, and reported it.
    swipe.setScrollOffset(800);
    swipe.publish([DEEP_ROW]);

    // The neighbouring month becomes current, at its top; its rows are measured at offset 0.
    const geometry = {
      measure: jest.fn(async () => {
        swipe.publish([FIRST_ROW]);
        return [];
      }),
    };
    const page = { current: 0 };
    const { rerender } = await renderHook(
      (props: { isCurrent: boolean }) =>
        useCurrentPageSwipe({
          isCurrent: props.isCurrent,
          rowSwipe: swipe,
          geometry,
          scrollOffset: page,
        }),
      { initialProps: { isCurrent: false } },
    );
    await rerender({ isCurrent: true });

    // A finger on the row at the top of the new page finds it.
    const manager: Manager = { fail: jest.fn(), activate: jest.fn() };
    await act(() => {
      handlers.onTouchesDown(
        {
          allTouches: [{ absoluteX: 300, absoluteY: 30 }],
          handlerTag: 3,
          pointerType: 0,
        },
        manager,
      );
    });
    expect(manager.fail).not.toHaveBeenCalled();
  });
});
