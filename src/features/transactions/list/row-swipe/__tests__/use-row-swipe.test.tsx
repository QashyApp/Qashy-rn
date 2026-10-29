import { act, renderHook } from "@testing-library/react-native";

import {
  useReleaseReturnedRows,
  useRowSwipe,
} from "@/features/transactions/list/row-swipe/use-row-swipe";
import type { SwipeRow } from "@/features/transactions/list/row-swipe/use-row-swipe";
import {
  ROW_REVEAL_WIDTH,
  springArrivalMs,
} from "@/features/transactions/list/row-swipe/resolve-row-swipe";

// Motion is off unless a test turns it on.
let mockMotion = { instant: true, travel: false };
jest.mock("@/components/ui/motion", () => ({
  useMotionPreference: () => mockMotion,
}));
beforeEach(() => {
  mockMotion = { instant: true, travel: false };
});

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    motion: {
      spring: { snappy: { damping: 20, stiffness: 200, mass: 1 } },
      duration: { fast: 120, base: 160 },
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
    expect(onAction).toHaveBeenCalledWith(
      "a",
      "skip",
      expect.anything(),
      undefined,
    );
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

  it("closes a row whose action keeps it in the list, with no confirming hold when motion is off", async () => {
    const onAction = jest.fn().mockReturnValue(true);
    const swipe = await setup(onAction);
    swipe.activeId.set("a");
    await act(() => {
      swipe.commit("a", "start");
    });
    expect(onAction).toHaveBeenCalledWith(
      "a",
      "markPaid",
      undefined,
      undefined,
    );
    expect(swipe.confirmingId.get()).toBe("");
    expect(swipe.activeX.get()).toBe(0);
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

  describe("the confirming hold of an action that keeps its row", () => {
    it("tells the screen how long the hold lasts, so what it opens can wait for it", async () => {
      mockMotion = { instant: false, travel: true };
      const onAction = jest.fn().mockReturnValue(true);
      const swipe = await setup(onAction);
      swipe.activeId.set("a");
      await act(() => {
        swipe.commit("a", "start");
      });
      // The spring from the row's place to the reveal line, as long as it really takes (it is not
      // a fixed time), then the 160ms hold and a frame or two of margin.
      const reach = springArrivalMs(
        { damping: 20, stiffness: 200, mass: 1 },
        0 - ROW_REVEAL_WIDTH,
        0,
      );
      expect(reach).toBeGreaterThan(0);
      expect(onAction).toHaveBeenCalledWith(
        "a",
        "markPaid",
        undefined,
        reach + 160 + 32,
      );
    });

    it("measures the hold from where the row was let go, not from rest", async () => {
      mockMotion = { instant: false, travel: true };
      const onAction = jest.fn().mockReturnValue(true);
      const swipe = await setup(onAction);
      // Dragged well past the line, as a swipe that commits is.
      swipe.activeId.set("a");
      swipe.activeX.set(170);
      await act(() => {
        swipe.commit("a", "start");
      });
      const near = onAction.mock.calls[0][3] as number;
      const spring = { damping: 20, stiffness: 200, mass: 1 };
      expect(near).toBe(
        springArrivalMs(spring, 170 - ROW_REVEAL_WIDTH, 0) + 160 + 32,
      );
    });

    it("shortens the hold's lead-in under reduced motion, and has none with motion off", async () => {
      mockMotion = { instant: false, travel: false };
      const reduced = jest.fn().mockReturnValue(true);
      const first = await setup(reduced);
      first.activeId.set("a");
      await act(() => {
        first.commit("a", "start");
      });
      // The short timing to the line (120ms), the 160ms hold and the margin.
      expect(reduced).toHaveBeenCalledWith("a", "markPaid", undefined, 312);

      mockMotion = { instant: true, travel: false };
      const off = jest.fn().mockReturnValue(true);
      const second = await setup(off);
      second.activeId.set("a");
      await act(() => {
        second.commit("a", "start");
      });
      expect(off).toHaveBeenCalledWith("a", "markPaid", undefined, undefined);
    });

    it("gives no hold to an action that leaves the list, and hides its row once the slide has arrived", async () => {
      mockMotion = { instant: false, travel: true };
      const onAction = jest.fn().mockReturnValue(true);
      const swipe = await setup(onAction);
      swipe.activeId.set("a");
      await act(() => {
        swipe.commit("a", "end");
      });
      // The spring from rest to the far edge (the row is 300 wide), as long as it really takes.
      const slide = springArrivalMs(
        { damping: 20, stiffness: 200, mass: 1 },
        0 - -ROW.width,
        0,
      );
      expect(slide).toBeGreaterThan(0);
      expect(onAction).toHaveBeenCalledWith("a", "skip", slide + 32, undefined);
    });

    it("hides a leaving row after the short timing under reduced motion, and at once with motion off", async () => {
      mockMotion = { instant: false, travel: false };
      const reduced = jest.fn().mockReturnValue(true);
      const first = await setup(reduced);
      first.activeId.set("a");
      await act(() => {
        first.commit("a", "end");
      });
      expect(reduced).toHaveBeenCalledWith("a", "skip", 120 + 32, undefined);

      mockMotion = { instant: true, travel: false };
      const off = jest.fn().mockReturnValue(true);
      const second = await setup(off);
      second.activeId.set("a");
      await act(() => {
        second.commit("a", "end");
      });
      expect(off).toHaveBeenCalledWith("a", "skip", 0, undefined);
    });

    it("does not leave the row marked open once the hold has closed it", async () => {
      // The test runtime finishes animations at once, so the hold is over by the time commit
      // returns: the open state it set for the hold (which swallows a tap) must be cleared again.
      mockMotion = { instant: false, travel: true };
      const swipe = await setup(jest.fn().mockReturnValue(true));
      swipe.activeId.set("a");
      await act(() => {
        swipe.commit("a", "start");
      });
      expect(swipe.confirmingId.get()).toBe("");
      expect(swipe.shouldSwallowPress("a")).toBe(false);
    });
  });
});

describe("useReleaseReturnedRows", () => {
  const none: ReadonlySet<string> = new Set();

  it("brings an undone row back to rest, and leaves a row that is still engaged", async () => {
    const onAction = jest.fn().mockReturnValue(true);
    const swipe = await setup(onAction);
    swipe.activeId.set("a");
    await act(() => {
      swipe.commit("a", "end");
    });
    expect(swipe.committingId.get()).toBe("a");
    expect(swipe.committingX.get()).not.toBe(0);

    // The screen hides the row while its action waits on Undo...
    const { rerender } = await renderHook(
      (props: { hidden: ReadonlySet<string>; pending: { id: string }[] }) =>
        useReleaseReturnedRows(swipe, props.hidden, props.pending),
      { initialProps: { hidden: new Set(["a"]), pending: [{ id: "a" }] } },
    );
    expect(swipe.committingX.get()).not.toBe(0);
    // ...and still while only the hide delay has passed.
    await rerender({ hidden: none, pending: [{ id: "a" }] });
    expect(swipe.committingId.get()).toBe("a");
    // Undo: nothing holds the row any more, so it slides back.
    await rerender({ hidden: none, pending: [] });
    expect(swipe.committingX.get()).toBe(0);
    expect(swipe.committingId.get()).toBe("");
  });
});
