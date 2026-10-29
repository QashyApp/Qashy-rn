import { act, renderHook } from "@testing-library/react-native";
import { GestureStateManager } from "react-native-gesture-handler";

import {
  useRowSwipe,
  type RowSwipeController,
  type SwipeRow,
} from "@/features/transactions/list/row-swipe/use-row-swipe";

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

interface Touch {
  absoluteX: number;
  absoluteY: number;
}
interface Manager {
  fail: jest.Mock;
  activate: jest.Mock;
}
/**
 * The gesture's own callbacks. RNGH's jest utilities drive a gesture's state and update events
 * through a mounted detector but have no way to send touch events (`onTouchesDown`/`Move`), which
 * are what this gesture decides on, so the tests call the handlers directly.
 */
interface Handlers {
  onTouchesDown(event: unknown, manager: Manager): void;
  onTouchesMove(event: unknown, manager: Manager): void;
  onStart(): void;
  onUpdate(event: { translationX: number }): void;
  onEnd(event: { velocityX: number }, success: boolean): void;
  onFinalize(): void;
}

const POSTED: SwipeRow = {
  id: "posted",
  top: 0,
  bottom: 60,
  width: 300,
  actions: { start: "changeCategory", end: "delete" },
};
const LATE: SwipeRow = {
  id: "late",
  top: 200,
  bottom: 260,
  width: 300,
  actions: { start: "changeCategory", end: "delete" },
};

const TAG = 7;
const down = (x: number, y: number) => ({
  allTouches: [{ absoluteX: x, absoluteY: y } satisfies Touch],
  handlerTag: TAG,
  pointerType: 0,
});
/** A second finger lands: the event lists both. */
const downSecond = (x: number, y: number) => ({
  allTouches: [
    { absoluteX: x, absoluteY: y } satisfies Touch,
    { absoluteX: x + 80, absoluteY: y + 10 } satisfies Touch,
  ],
  handlerTag: TAG,
  pointerType: 0,
});
const move = (x: number, y: number) => ({
  allTouches: [{ absoluteX: x, absoluteY: y } satisfies Touch],
  handlerTag: TAG,
});
/** Lets the measurement's promise chain run to its end. */
const answered = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

// The state manager the measured answer uses outside a touch callback has no native side here.
beforeEach(() => {
  jest.spyOn(GestureStateManager, "activate").mockImplementation(() => {});
  jest.spyOn(GestureStateManager, "fail").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const manager = (): Manager => ({ fail: jest.fn(), activate: jest.fn() });

async function setup(onAction = jest.fn().mockReturnValue(true)) {
  const { result } = await renderHook(() =>
    useRowSwipe({ enabled: true, isRtl: false, onAction }),
  );
  await act(() => {
    result.current.publish([POSTED]);
  });
  const handlers = (result.current.gesture as unknown as { handlers: Handlers })
    .handlers;
  return { swipe: result.current as RowSwipeController, handlers, onAction };
}

describe("the row swipe's touch handling", () => {
  it("fails at touch-down on empty space when the rows are fresh", async () => {
    const { handlers } = await setup();
    const m = manager();
    handlers.onTouchesDown(down(300, 400), m);
    expect(m.fail).toHaveBeenCalledTimes(1);
  });

  it("leaves the system gesture strip at the screen edge alone", async () => {
    const { handlers } = await setup();
    const m = manager();
    handlers.onTouchesDown(down(10, 30), m);
    expect(m.fail).toHaveBeenCalledTimes(1);
  });

  it("takes a sideways move of 12dp, not 10", async () => {
    const { handlers } = await setup();
    const m = manager();
    handlers.onTouchesDown(down(300, 30), m);
    handlers.onTouchesMove(move(290, 30), m);
    expect(m.activate).not.toHaveBeenCalled();
    handlers.onTouchesMove(move(288, 30), m);
    expect(m.activate).toHaveBeenCalledTimes(1);
    expect(m.fail).not.toHaveBeenCalled();
  });

  it("takes a diagonal move inside the cone and gives a steeper one to the scroll", async () => {
    const inside = await setup();
    const a = manager();
    inside.handlers.onTouchesDown(down(300, 30), a);
    inside.handlers.onTouchesMove(move(286, 42), a);
    expect(a.activate).toHaveBeenCalledTimes(1);

    const outside = await setup();
    const b = manager();
    outside.handlers.onTouchesDown(down(300, 30), b);
    outside.handlers.onTouchesMove(move(290, 44), b);
    expect(b.fail).toHaveBeenCalledTimes(1);
    expect(b.activate).not.toHaveBeenCalled();
  });

  describe("a touch that misses the rows while they may be stale", () => {
    it("waits instead of failing, and a vertical move hands it to the scroll", async () => {
      const { swipe, handlers } = await setup();
      swipe.setScrollOffset(40);
      const m = manager();
      handlers.onTouchesDown(down(300, 230), m);
      expect(m.fail).not.toHaveBeenCalled();
      handlers.onTouchesMove(move(300, 250), m);
      expect(m.fail).toHaveBeenCalledTimes(1);
    });

    it("measures on the first sideways move, then swipes the row that was not published with no further move", async () => {
      const { swipe, handlers } = await setup();
      const measure = jest.fn(async () => {
        swipe.publish([POSTED, LATE]);
      });
      swipe.setMeasurer(measure);
      swipe.setScrollOffset(0);
      swipe.markStale();
      const m = manager();
      handlers.onTouchesDown(down(300, 230), m);
      expect(m.fail).not.toHaveBeenCalled();
      // Not yet sideways enough: nothing is measured.
      handlers.onTouchesMove(move(296, 230), m);
      expect(measure).not.toHaveBeenCalled();
      handlers.onTouchesMove(move(280, 230), m);
      expect(measure).toHaveBeenCalledTimes(1);
      expect(GestureStateManager.activate).not.toHaveBeenCalled();
      // The measurement's answer decides, with the finger standing still.
      await answered();
      expect(GestureStateManager.activate).toHaveBeenCalledWith(TAG);
      expect(GestureStateManager.fail).not.toHaveBeenCalled();
      expect(m.fail).not.toHaveBeenCalled();
      handlers.onStart();
      expect(swipe.activeId.get()).toBe("late");
    });

    it("hit-tests the row under the landing point even if the list moved while measuring", async () => {
      const { swipe, handlers } = await setup();
      swipe.setScrollOffset(0);
      swipe.setMeasurer(async () => {
        swipe.publish([POSTED, LATE]);
        // The list reports another offset by the time the answer is in.
        swipe.setScrollOffset(500);
      });
      swipe.markStale();
      const m = manager();
      handlers.onTouchesDown(down(300, 230), m);
      handlers.onTouchesMove(move(280, 230), m);
      await answered();
      expect(GestureStateManager.activate).toHaveBeenCalledWith(TAG);
    });

    it("gives the touch to the pager as soon as the measured rows still miss", async () => {
      const { swipe, handlers } = await setup();
      swipe.setMeasurer(async () => {
        swipe.publish([POSTED]);
      });
      swipe.markStale();
      const m = manager();
      handlers.onTouchesDown(down(300, 400), m);
      handlers.onTouchesMove(move(270, 400), m);
      await answered();
      expect(GestureStateManager.fail).toHaveBeenCalledWith(TAG);
      expect(GestureStateManager.activate).not.toHaveBeenCalled();
    });

    it("decides at once with nothing to measure", async () => {
      const { swipe, handlers } = await setup();
      swipe.markStale();
      const m = manager();
      handlers.onTouchesDown(down(300, 400), m);
      handlers.onTouchesMove(move(270, 400), m);
      await answered();
      expect(GestureStateManager.fail).toHaveBeenCalledWith(TAG);
    });

    it("ignores an answer that arrives after the touch has lifted", async () => {
      const { swipe, handlers } = await setup();
      swipe.setMeasurer(async () => {
        swipe.publish([POSTED, LATE]);
      });
      swipe.markStale();
      const m = manager();
      handlers.onTouchesDown(down(300, 230), m);
      handlers.onTouchesMove(move(280, 230), m);
      handlers.onFinalize();
      await answered();
      expect(GestureStateManager.activate).not.toHaveBeenCalled();
      expect(GestureStateManager.fail).not.toHaveBeenCalled();
    });

    it("stays undecided after a cleared list, but not after an empty publish", async () => {
      const { swipe, handlers } = await setup();
      swipe.clear();
      const waiting = manager();
      handlers.onTouchesDown(down(300, 30), waiting);
      expect(waiting.fail).not.toHaveBeenCalled();
      handlers.onFinalize();
      swipe.publish([]);
      const settled = manager();
      handlers.onTouchesDown(down(300, 30), settled);
      expect(settled.fail).toHaveBeenCalledTimes(1);
    });

    it("measures nothing for a touch that lifts before moving", async () => {
      const { swipe, handlers } = await setup();
      const measure = jest.fn(async () => undefined);
      swipe.setMeasurer(measure);
      swipe.markStale();
      handlers.onTouchesDown(down(300, 400), manager());
      handlers.onFinalize();
      expect(measure).not.toHaveBeenCalled();
    });
  });

  describe("releasing a drag", () => {
    async function drag(translationX: number, velocityX: number) {
      const { swipe, handlers, onAction } = await setup();
      const m = manager();
      handlers.onTouchesDown(down(300, 30), m);
      handlers.onTouchesMove(move(280, 30), m);
      handlers.onStart();
      await act(() => {
        handlers.onUpdate({ translationX });
        handlers.onEnd({ velocityX }, true);
      });
      return { swipe, onAction };
    }

    it("does not delete on a fling that is too slow, and opens the row instead", async () => {
      const { swipe, onAction } = await drag(-110, -1000);
      expect(onAction).not.toHaveBeenCalled();
      expect(swipe.activeX.get()).toBe(-swipe.revealWidth);
    });

    it("deletes on a hard fling from far enough along", async () => {
      const { onAction } = await drag(-110, -1500);
      expect(onAction).toHaveBeenCalledWith(
        "posted",
        "delete",
        expect.anything(),
        undefined,
      );
    });

    it("still takes the other side's action on an ordinary fling", async () => {
      const { onAction } = await drag(100, 700);
      expect(onAction).toHaveBeenCalledWith(
        "posted",
        "changeCategory",
        undefined,
        undefined,
      );
    });

    it("holds the drag back past the commit line", async () => {
      const { swipe, handlers } = await setup();
      const m = manager();
      handlers.onTouchesDown(down(300, 30), m);
      handlers.onTouchesMove(move(280, 30), m);
      handlers.onStart();
      await act(() => {
        handlers.onUpdate({ translationX: -400 });
      });
      // The commit line on a 300dp row is 150dp; the 250dp beyond it moves the row by 35% of that.
      expect(swipe.activeX.get()).toBeCloseTo(-(150 + 250 * 0.35));
    });
  });
});

describe("a swipe that is interrupted", () => {
  async function swiping(translationX = -60) {
    const { swipe, handlers, onAction } = await setup();
    const m = manager();
    handlers.onTouchesDown(down(300, 30), m);
    handlers.onTouchesMove(move(280, 30), m);
    handlers.onStart();
    await act(() => {
      handlers.onUpdate({ translationX });
    });
    return { swipe, handlers, onAction, m };
  }

  it("lets the swipe carry on when a second finger lands, and settles it at the end", async () => {
    const { swipe, handlers, m } = await swiping(-70);
    const second = manager();
    handlers.onTouchesDown(downSecond(300, 30), second);
    // Failing the pan here would end it with no settle and strand the row half open.
    expect(second.fail).not.toHaveBeenCalled();
    expect(m.fail).not.toHaveBeenCalled();
    await act(() => {
      handlers.onUpdate({ translationX: -90 });
      handlers.onEnd({ velocityX: 0 }, true);
    });
    expect(swipe.activeX.get()).toBe(-swipe.revealWidth);
  });

  it("settles a swipe cut short after the second finger, instead of stranding it", async () => {
    const { swipe, handlers } = await swiping(-70);
    handlers.onTouchesDown(downSecond(300, 30), manager());
    await act(() => {
      handlers.onFinalize();
    });
    expect(swipe.activeX.get()).toBe(0);
  });

  it("closes the row and ends the gesture when the swipe is suspended mid-swipe", async () => {
    const { swipe, handlers, m, onAction } = await swiping(-70);
    swipe.suspend("selection", true);
    await act(() => {
      handlers.onTouchesMove(move(250, 30), m);
    });
    expect(m.fail).toHaveBeenCalledTimes(1);
    expect(swipe.activeX.get()).toBe(0);
    // The end that follows a failed gesture does nothing more.
    await act(() => {
      handlers.onEnd({ velocityX: -2000 }, false);
      handlers.onFinalize();
    });
    expect(onAction).not.toHaveBeenCalled();
    expect(swipe.activeX.get()).toBe(0);
  });

  it("closes the row when a second finger lands while the swipe is suspended", async () => {
    const { swipe, handlers } = await swiping(-70);
    swipe.suspend("drag", true);
    const second = manager();
    await act(() => {
      handlers.onTouchesDown(downSecond(300, 30), second);
    });
    expect(second.fail).toHaveBeenCalledTimes(1);
    expect(swipe.activeX.get()).toBe(0);
  });
});

describe("the edge guard on native", () => {
  it("lets a touch on an inset open row's button start where the row is, not from zero", async () => {
    const { swipe, handlers } = await setup();
    // A row inset 20dp from the screen: its revealed button is x 20..108.
    await act(() => {
      swipe.publish([{ ...POSTED, left: 20, width: 340 }]);
    });
    swipe.activeId.set("posted");
    swipe.activeX.set(88);
    const outside = manager();
    // 18dp from the edge, left of the button: the system gesture's.
    handlers.onTouchesDown(down(18, 30), outside);
    expect(outside.fail).toHaveBeenCalledTimes(1);
    const onButton = manager();
    handlers.onTouchesDown(down(22, 30), onButton);
    expect(onButton.fail).not.toHaveBeenCalled();
  });
});
