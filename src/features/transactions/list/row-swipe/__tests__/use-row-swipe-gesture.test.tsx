import { act, renderHook } from "@testing-library/react-native";

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

const down = (x: number, y: number) => ({
  allTouches: [{ absoluteX: x, absoluteY: y } satisfies Touch],
  pointerType: 0,
});
const move = (x: number, y: number) => ({
  allTouches: [{ absoluteX: x, absoluteY: y } satisfies Touch],
});
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

    it("measures on the first sideways move, then swipes the row that was not published", async () => {
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
      expect(m.activate).not.toHaveBeenCalled();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      handlers.onTouchesMove(move(270, 230), m);
      expect(m.activate).toHaveBeenCalledTimes(1);
      expect(m.fail).not.toHaveBeenCalled();
      handlers.onStart();
      expect(swipe.activeId.get()).toBe("late");
    });

    it("gives the touch to the pager when the measured rows still miss", async () => {
      const { swipe, handlers } = await setup();
      swipe.setMeasurer(async () => {
        swipe.publish([POSTED]);
      });
      swipe.markStale();
      const m = manager();
      handlers.onTouchesDown(down(300, 400), m);
      handlers.onTouchesMove(move(270, 400), m);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      handlers.onTouchesMove(move(250, 400), m);
      expect(m.fail).toHaveBeenCalledTimes(1);
      expect(m.activate).not.toHaveBeenCalled();
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
      );
    });

    it("still takes the other side's action on an ordinary fling", async () => {
      const { onAction } = await drag(100, 700);
      expect(onAction).toHaveBeenCalledWith(
        "posted",
        "changeCategory",
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
