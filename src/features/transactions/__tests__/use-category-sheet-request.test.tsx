import { act, renderHook } from "@testing-library/react-native";

import { useCategorySheetRequest } from "@/features/transactions/use-category-sheet-request";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function setup() {
  const open = jest.fn();
  const hook = await renderHook(() => useCategorySheetRequest(open));
  return { open, ...hook };
}

describe("useCategorySheetRequest", () => {
  it("opens at once when the row has no hold", async () => {
    const { open, result } = await setup();
    await act(() => {
      result.current.request("a");
      result.current.request("b", 0);
    });
    expect(open.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("waits for the hold", async () => {
    const { open, result } = await setup();
    await act(() => {
      result.current.request("a", 400);
    });
    await act(() => {
      jest.advanceTimersByTime(399);
    });
    expect(open).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(open).toHaveBeenCalledWith("a");
  });

  it("opens the first at once when a second arrives during its hold, and the second after its own", async () => {
    const { open, result } = await setup();
    await act(() => {
      result.current.request("a", 400);
      jest.advanceTimersByTime(100);
      result.current.request("b", 400);
    });
    expect(open.mock.calls).toEqual([["a"]]);
    await act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(open.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("drops what is waiting when cancelled, as when the screen loses focus", async () => {
    const { open, result } = await setup();
    await act(() => {
      result.current.request("a", 400);
      result.current.cancel();
      jest.advanceTimersByTime(1000);
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("drops what is waiting when the screen unmounts", async () => {
    const { open, result, unmount } = await setup();
    await act(() => {
      result.current.request("a", 400);
    });
    await unmount();
    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(open).not.toHaveBeenCalled();
  });
});
