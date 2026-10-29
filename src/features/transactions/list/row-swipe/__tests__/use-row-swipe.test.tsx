import { act, renderHook } from "@testing-library/react-native";

import { useRowSwipe } from "@/features/transactions/list/row-swipe/use-row-swipe";
import type { SwipeRow } from "@/features/transactions/list/row-swipe/use-row-swipe";

jest.mock("@/components/ui/motion", () => ({
  useMotionPreference: () => ({ instant: true, travel: false }),
}));

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    motion: {
      spring: { snappy: { damping: 20, stiffness: 200, mass: 1 } },
      duration: { fast: 120 },
    },
  }),
}));

const ROW: SwipeRow = {
  id: "a",
  top: 0,
  bottom: 60,
  width: 300,
  actions: { start: "markPaid", end: "skip" },
};

async function setup(onAction: jest.Mock) {
  const { result } = await renderHook(() =>
    useRowSwipe({ enabled: true, isRtl: false, onAction }),
  );
  await act(() => {
    result.current.publish([ROW]);
  });
  return result.current;
}

describe("useRowSwipe", () => {
  it("opens the row and takes the action once for a repeated press", async () => {
    const onAction = jest.fn().mockReturnValue(true);
    const swipe = await setup(onAction);
    swipe.activeId.set("a");
    await act(() => {
      swipe.commit("a", "end");
      swipe.commit("a", "end");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("a", "skip", expect.anything());
    expect(swipe.committingId.get()).toBe("a");
  });

  it("brings a row back when its action was refused", async () => {
    const onAction = jest.fn().mockReturnValue(false);
    const swipe = await setup(onAction);
    swipe.activeId.set("a");
    await act(() => {
      swipe.commit("a", "end");
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(swipe.committingX.get()).toBe(0);
    expect(swipe.committingId.get()).toBe("");
  });

  it("brings a row back when the action throws", async () => {
    const onAction = jest.fn().mockImplementation(() => {
      throw new Error("nope");
    });
    const swipe = await setup(onAction);
    swipe.activeId.set("a");
    await act(() => {
      try {
        swipe.commit("a", "end");
      } catch {
        // The throw surfaces through the UI-runtime shim; the row must still come back.
      }
    });
    expect(swipe.committingId.get()).toBe("");
  });

  it("keeps a row that was taken off to the side", async () => {
    const onAction = jest.fn().mockReturnValue(true);
    const swipe = await setup(onAction);
    swipe.activeId.set("a");
    await act(() => {
      swipe.commit("a", "end");
    });
    expect(swipe.committingId.get()).toBe("a");
    expect(swipe.committingX.get()).not.toBe(0);
  });
});
