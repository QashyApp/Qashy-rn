import {
  COMMIT_RESISTANCE,
  DESTRUCTIVE_FLING_VELOCITY,
  EDGE_GUARD,
  EDGE_GUARD_OPEN_BUTTON,
  ICON_REST_SCALE,
  SPRING_MAX_MS,
  ROW_REVEAL_WIDTH,
  RUBBER_LIMIT,
  classifyMove,
  commitDistance,
  commitOffset,
  commitProgress,
  displayOffset,
  drawnSlope,
  drawnVelocity,
  findRowAt,
  iconScale,
  isPastCommitLine,
  resolveRowSwipe,
  settleOffset,
  sideOf,
  springArrivalMs,
  touchStartsAtEdge,
} from "@/features/transactions/list/row-swipe/resolve-row-swipe";

const WIDTH = 360;
const REVEAL = ROW_REVEAL_WIDTH;
const BOTH = { start: true, end: true };

function release(
  offset: number,
  velocity = 0,
  options: {
    isRtl?: boolean;
    sides?: { start: boolean; end: boolean };
    width?: number;
    destructive?: "start" | "end" | null;
  } = {},
) {
  return resolveRowSwipe({
    offset,
    velocity,
    rowWidth: options.width ?? WIDTH,
    revealWidth: REVEAL,
    isRtl: options.isRtl ?? false,
    sides: options.sides ?? BOTH,
    destructive: options.destructive,
  });
}

describe("sideOf", () => {
  it("maps screen direction to start and end", () => {
    expect(sideOf(10, false)).toBe("start");
    expect(sideOf(-10, false)).toBe("end");
    expect(sideOf(10, true)).toBe("end");
    expect(sideOf(-10, true)).toBe("start");
    expect(sideOf(0, false)).toBeNull();
  });
});

describe("resolveRowSwipe", () => {
  it("closes a short drag", () => {
    expect(release(20)).toEqual({ settle: "closed", commit: null });
    expect(release(-30)).toEqual({ settle: "closed", commit: null });
  });

  it("settles open once the drag is well into the reveal", () => {
    expect(release(REVEAL * 0.7)).toEqual({
      settle: "open-start",
      commit: null,
    });
    expect(release(-REVEAL)).toEqual({ settle: "open-end", commit: null });
  });

  it("keeps an open row open after a small drag back", () => {
    expect(release(REVEAL * 0.85)).toEqual({
      settle: "open-start",
      commit: null,
    });
  });

  it("commits past half the row's width", () => {
    expect(release(WIDTH * 0.5)).toEqual({ settle: "closed", commit: "start" });
    expect(release(-WIDTH * 0.6)).toEqual({ settle: "closed", commit: "end" });
    expect(release(WIDTH * 0.49).commit).toBeNull();
  });

  it("commits a fling outward past the reveal", () => {
    expect(release(REVEAL + 4, 900).commit).toBe("start");
    expect(release(-(REVEAL + 4), -900).commit).toBe("end");
  });

  it("opens, but does not commit, a fling that ends inside the reveal", () => {
    expect(release(REVEAL * 0.5, 900)).toEqual({
      settle: "open-start",
      commit: null,
    });
    expect(release(REVEAL * 0.1, 900)).toEqual({
      settle: "closed",
      commit: null,
    });
  });

  it("closes on an inward fling, even from beyond the commit line", () => {
    expect(release(REVEAL, -900)).toEqual({ settle: "closed", commit: null });
    expect(release(WIDTH * 0.7, -900)).toEqual({
      settle: "closed",
      commit: null,
    });
    expect(release(-WIDTH * 0.7, 900)).toEqual({
      settle: "closed",
      commit: null,
    });
  });

  describe("a destructive side", () => {
    const destructive = "end" as const;
    const fast = DESTRUCTIVE_FLING_VELOCITY;

    it("commits a hard fling from far enough along", () => {
      expect(release(-WIDTH * 0.3, -fast, { destructive }).commit).toBe("end");
      expect(release(-WIDTH * 0.4, -fast - 300, { destructive }).commit).toBe(
        "end",
      );
    });

    it("opens, but does not commit, a fling that is too slow", () => {
      // 900 dp/s commits a harmless action but not Delete.
      expect(release(-(REVEAL + 40), -900).commit).toBe("end");
      expect(release(-(REVEAL + 40), -900, { destructive })).toEqual({
        settle: "open-end",
        commit: null,
      });
    });

    it("opens, but does not commit, a fast fling that is too short", () => {
      expect(release(-WIDTH * 0.29, -fast * 2, { destructive })).toEqual({
        settle: "open-end",
        commit: null,
      });
      expect(
        release(-(REVEAL + 4), -fast * 2, { destructive }).commit,
      ).toBeNull();
    });

    it("still commits by distance alone, however slowly it is released", () => {
      expect(release(-WIDTH * 0.5, 0, { destructive }).commit).toBe("end");
    });

    it("leaves the other side's fling rule alone", () => {
      expect(release(REVEAL + 4, 900, { destructive }).commit).toBe("start");
    });

    it("never fling-commits from inside the reveal on a narrow row", () => {
      const narrow = 200;
      expect(
        release(-(REVEAL - 10), -fast * 2, { destructive, width: narrow })
          .commit,
      ).toBeNull();
    });

    it("mirrors in right to left", () => {
      expect(
        release(WIDTH * 0.3, fast, { destructive, isRtl: true }).commit,
      ).toBe("end");
      expect(
        release(WIDTH * 0.3, 900, { destructive, isRtl: true }).commit,
      ).toBeNull();
    });
  });

  it("never commits closer than a reveal and a quarter, even on a narrow row", () => {
    const narrow = 120;
    expect(commitDistance(narrow, REVEAL)).toBeCloseTo(REVEAL * 1.25);
    expect(release(narrow * 0.5, 0, { width: narrow }).commit).toBeNull();
    expect(release(REVEAL * 1.3, 0, { width: narrow }).commit).toBe("start");
  });

  describe("right to left", () => {
    it("mirrors the sides", () => {
      expect(release(-WIDTH * 0.6, 0, { isRtl: true }).commit).toBe("start");
      expect(release(WIDTH * 0.6, 0, { isRtl: true }).commit).toBe("end");
      expect(release(-REVEAL, 0, { isRtl: true }).settle).toBe("open-start");
      expect(release(REVEAL, 0, { isRtl: true }).settle).toBe("open-end");
    });

    it("applies a fling in the mirrored direction", () => {
      expect(release(-(REVEAL + 4), -900, { isRtl: true }).commit).toBe(
        "start",
      );
      expect(release(-(REVEAL + 4), 900, { isRtl: true }).commit).toBeNull();
    });
  });

  describe("a side without an action", () => {
    const noStart = { start: false, end: true };
    const noEnd = { start: true, end: false };

    it("never opens or commits", () => {
      expect(release(WIDTH * 0.8, 2000, { sides: noStart })).toEqual({
        settle: "closed",
        commit: null,
      });
      expect(release(-WIDTH * 0.8, -2000, { sides: noEnd })).toEqual({
        settle: "closed",
        commit: null,
      });
    });

    it("still resolves the other side", () => {
      expect(release(-WIDTH * 0.6, 0, { sides: noStart }).commit).toBe("end");
      expect(release(WIDTH * 0.6, 0, { sides: noEnd }).commit).toBe("start");
    });

    it("follows the disabled side in right to left too", () => {
      // Start is the left in RTL.
      expect(
        release(-WIDTH * 0.8, 0, { isRtl: true, sides: noStart }).commit,
      ).toBeNull();
      expect(
        release(WIDTH * 0.8, 0, { isRtl: true, sides: noStart }).commit,
      ).toBe("end");
    });
  });
});

describe("displayOffset", () => {
  it("follows the finger one to one on an enabled side up to the commit line", () => {
    const line = commitDistance(WIDTH, REVEAL);
    expect(displayOffset(50, WIDTH, false, BOTH)).toBe(50);
    expect(displayOffset(-120, WIDTH, false, BOTH)).toBe(-120);
    expect(displayOffset(line, WIDTH, false, BOTH)).toBe(line);
    expect(displayOffset(-line, WIDTH, false, BOTH)).toBe(-line);
  });

  it("resists past the commit line and never passes the row's width", () => {
    const line = commitDistance(WIDTH, REVEAL);
    expect(displayOffset(line + 100, WIDTH, false, BOTH)).toBeCloseTo(
      line + 100 * COMMIT_RESISTANCE,
    );
    expect(displayOffset(-(line + 100), WIDTH, false, BOTH)).toBeCloseTo(
      -(line + 100 * COMMIT_RESISTANCE),
    );
    expect(displayOffset(WIDTH * 4, WIDTH, false, BOTH)).toBe(WIDTH);
    expect(displayOffset(-WIDTH * 4, WIDTH, false, BOTH)).toBe(-WIDTH);
  });

  it("never lets resistance undo the commit line, so a held drag still commits", () => {
    const line = commitDistance(WIDTH, REVEAL);
    const drawn = displayOffset(line + 1, WIDTH, false, BOTH);
    expect(isPastCommitLine(drawn, WIDTH, REVEAL, false, BOTH)).toBe(true);
    expect(release(drawn).commit).toBe("start");
  });

  it("rubber-bands a disabled side toward a limit", () => {
    const sides = { start: false, end: true };
    const small = displayOffset(30, WIDTH, false, sides);
    const large = displayOffset(300, WIDTH, false, sides);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(30);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(RUBBER_LIMIT);
    expect(displayOffset(-100, WIDTH, false, sides)).toBe(-100);
  });

  it("resists past the commit line in right to left too", () => {
    const line = commitDistance(WIDTH, REVEAL);
    expect(displayOffset(line + 100, WIDTH, true, BOTH)).toBeCloseTo(
      line + 100 * COMMIT_RESISTANCE,
    );
  });

  it("rubber-bands the mirrored side in right to left", () => {
    const sides = { start: false, end: true };
    expect(displayOffset(-300, WIDTH, true, sides)).toBeGreaterThan(
      -RUBBER_LIMIT,
    );
    expect(displayOffset(-300, WIDTH, true, sides)).toBeLessThan(0);
    expect(displayOffset(100, WIDTH, true, sides)).toBe(100);
  });

  it("is zero at rest", () => {
    expect(displayOffset(0, WIDTH, false, BOTH)).toBe(0);
  });
});

describe("drawnSlope and drawnVelocity", () => {
  const line = commitDistance(WIDTH, REVEAL);
  const ONE_SIDE = { start: false, end: true };

  it("is 1 up to the commit line and at rest", () => {
    expect(drawnSlope(0, WIDTH, REVEAL, false, BOTH)).toBe(1);
    expect(drawnSlope(60, WIDTH, REVEAL, false, BOTH)).toBe(1);
    expect(drawnSlope(-line, WIDTH, REVEAL, false, BOTH)).toBe(1);
  });

  it("is the commit resistance past the line, and 0 once the row has reached its width", () => {
    expect(drawnSlope(line + 10, WIDTH, REVEAL, false, BOTH)).toBe(
      COMMIT_RESISTANCE,
    );
    expect(drawnSlope(-(line + 10), WIDTH, REVEAL, true, BOTH)).toBe(
      COMMIT_RESISTANCE,
    );
    expect(drawnSlope(WIDTH, WIDTH, REVEAL, false, BOTH)).toBe(0);
  });

  it("is the derivative of the drawn offset, on the held stretch and on a rubber band", () => {
    const check = (
      raw: number,
      isRtl: boolean,
      sides: { start: boolean; end: boolean },
    ) => {
      const h = 0.001;
      const at = (value: number) =>
        displayOffset(value, WIDTH, isRtl, sides, REVEAL);
      const numeric = (at(raw + h) - at(raw - h)) / (2 * h);
      expect(drawnSlope(at(raw), WIDTH, REVEAL, isRtl, sides)).toBeCloseTo(
        numeric,
        3,
      );
    };
    check(line + 40, false, BOTH);
    check(-(line + 40), false, BOTH);
    check(line + 40, true, BOTH);
    check(20, false, ONE_SIDE);
    check(-5, false, ONE_SIDE);
    check(-200, false, ONE_SIDE);
    check(-20, true, ONE_SIDE);
  });

  it("scales the release velocity by the slope and keeps its sign", () => {
    const drawn = displayOffset(line + 80, WIDTH, false, BOTH);
    expect(drawnVelocity(drawn, 1000, WIDTH, REVEAL, false, BOTH)).toBeCloseTo(
      1000 * COMMIT_RESISTANCE,
    );
    expect(drawnVelocity(drawn, -1000, WIDTH, REVEAL, false, BOTH)).toBeCloseTo(
      -1000 * COMMIT_RESISTANCE,
    );
    expect(drawnVelocity(40, 1000, WIDTH, REVEAL, false, BOTH)).toBe(1000);
  });
});

describe("isPastCommitLine", () => {
  it("flips at the commit distance on an enabled side only", () => {
    const line = commitDistance(WIDTH, REVEAL);
    expect(isPastCommitLine(line - 1, WIDTH, REVEAL, false, BOTH)).toBe(false);
    expect(isPastCommitLine(line, WIDTH, REVEAL, false, BOTH)).toBe(true);
    expect(isPastCommitLine(-line, WIDTH, REVEAL, false, BOTH)).toBe(true);
    expect(
      isPastCommitLine(line, WIDTH, REVEAL, false, { start: false, end: true }),
    ).toBe(false);
  });
});

describe("rest and commit offsets", () => {
  it("rests open on the side that was pulled", () => {
    expect(settleOffset("closed", REVEAL, false)).toBe(0);
    expect(settleOffset("open-start", REVEAL, false)).toBe(REVEAL);
    expect(settleOffset("open-end", REVEAL, false)).toBe(-REVEAL);
    expect(settleOffset("open-start", REVEAL, true)).toBe(-REVEAL);
    expect(settleOffset("open-end", REVEAL, true)).toBe(REVEAL);
  });

  it("slides a commit off the side it was pulled toward", () => {
    expect(commitOffset("start", WIDTH, false)).toBe(WIDTH);
    expect(commitOffset("end", WIDTH, false)).toBe(-WIDTH);
    expect(commitOffset("start", WIDTH, true)).toBe(-WIDTH);
    expect(commitOffset("end", WIDTH, true)).toBe(WIDTH);
  });
});

describe("findRowAt", () => {
  const tops = [0, 70, 140, 300];
  const bottoms = [64, 134, 204, 364];

  it("finds the row containing y", () => {
    expect(findRowAt(tops, bottoms, 0)).toBe(0);
    expect(findRowAt(tops, bottoms, 63)).toBe(0);
    expect(findRowAt(tops, bottoms, 70)).toBe(1);
    expect(findRowAt(tops, bottoms, 200)).toBe(2);
    expect(findRowAt(tops, bottoms, 363)).toBe(3);
  });

  it("returns -1 in gaps and outside the rows", () => {
    expect(findRowAt(tops, bottoms, 64)).toBe(-1);
    expect(findRowAt(tops, bottoms, 250)).toBe(-1);
    expect(findRowAt(tops, bottoms, -5)).toBe(-1);
    expect(findRowAt(tops, bottoms, 400)).toBe(-1);
    expect(findRowAt([], [], 10)).toBe(-1);
  });
});

describe("commit progress and icon scale", () => {
  const line = commitDistance(WIDTH, REVEAL);

  it("runs from 0 at rest to 1 at the commit line, in either direction", () => {
    expect(commitProgress(0, WIDTH, REVEAL)).toBe(0);
    expect(commitProgress(line / 2, WIDTH, REVEAL)).toBeCloseTo(0.5);
    expect(commitProgress(-line / 2, WIDTH, REVEAL)).toBeCloseTo(0.5);
    expect(commitProgress(line, WIDTH, REVEAL)).toBe(1);
    expect(commitProgress(line * 2, WIDTH, REVEAL)).toBe(1);
  });

  it("scales the icon from 0.8 to 1.0", () => {
    expect(iconScale(0, WIDTH, REVEAL)).toBeCloseTo(ICON_REST_SCALE);
    expect(iconScale(line / 2, WIDTH, REVEAL)).toBeCloseTo(0.9);
    expect(iconScale(-line, WIDTH, REVEAL)).toBeCloseTo(1);
    expect(iconScale(line * 3, WIDTH, REVEAL)).toBeCloseTo(1);
  });
});

describe("classifyMove", () => {
  it("waits inside the dead zone", () => {
    expect(classifyMove(0, 0)).toBe("wait");
    expect(classifyMove(11, 0)).toBe("wait");
    expect(classifyMove(0, -11)).toBe("wait");
    expect(classifyMove(8, 8)).toBe("wait");
  });

  it("takes a sideways move at 12dp", () => {
    expect(classifyMove(12, 0)).toBe("activate");
    expect(classifyMove(-12, 5)).toBe("activate");
  });

  it("takes a diagonal inside the 45 degree cone, including exactly 45", () => {
    expect(classifyMove(14, 13)).toBe("activate");
    expect(classifyMove(-13, 13)).toBe("activate");
    expect(classifyMove(20, 12)).toBe("activate");
  });

  it("fails a vertical move at 12dp", () => {
    expect(classifyMove(0, 12)).toBe("fail");
    expect(classifyMove(5, -12)).toBe("fail");
  });

  it("fails a diagonal outside the cone", () => {
    expect(classifyMove(13, 14)).toBe("fail");
    expect(classifyMove(-4, 16)).toBe("fail");
  });

  it("does not fail a mostly sideways move that has also drifted vertically", () => {
    // The old rule failed at 10dp of vertical travel whatever the sideways travel was.
    expect(classifyMove(30, 11)).toBe("activate");
  });
});

describe("touchStartsAtEdge", () => {
  const screen = 400;

  it("guards the system gesture strip on both edges", () => {
    expect(touchStartsAtEdge(EDGE_GUARD - 1, screen, 0)).toBe(true);
    expect(touchStartsAtEdge(screen - EDGE_GUARD + 1, screen, 0)).toBe(true);
    expect(touchStartsAtEdge(EDGE_GUARD, screen, 0)).toBe(false);
    expect(touchStartsAtEdge(screen - EDGE_GUARD, screen, 0)).toBe(false);
    expect(touchStartsAtEdge(200, screen, 0)).toBe(false);
  });

  it("lets a touch on an open row's button start closer to the edge", () => {
    const left = ROW_REVEAL_WIDTH;
    expect(touchStartsAtEdge(EDGE_GUARD_OPEN_BUTTON, screen, left)).toBe(false);
    expect(touchStartsAtEdge(EDGE_GUARD_OPEN_BUTTON - 1, screen, left)).toBe(
      true,
    );
    const right = -ROW_REVEAL_WIDTH;
    expect(
      touchStartsAtEdge(screen - EDGE_GUARD_OPEN_BUTTON, screen, right),
    ).toBe(false);
    expect(
      touchStartsAtEdge(screen - EDGE_GUARD_OPEN_BUTTON + 1, screen, right),
    ).toBe(true);
  });

  it("keeps the full guard for a touch that is not on the button", () => {
    // The row is open to the right, so the right edge is plain row.
    expect(
      touchStartsAtEdge(
        screen - EDGE_GUARD_OPEN_BUTTON,
        screen,
        ROW_REVEAL_WIDTH,
      ),
    ).toBe(true);
    // On the button's side but beyond its strip.
    expect(
      touchStartsAtEdge(ROW_REVEAL_WIDTH + 1, screen, ROW_REVEAL_WIDTH),
    ).toBe(false);
  });

  it("places the button from the row's own window x, not from zero", () => {
    // A row inset 20dp: its left button is x 20..108.
    const inset = { left: 20, width: 340 };
    expect(
      touchStartsAtEdge(
        EDGE_GUARD_OPEN_BUTTON + 4,
        screen,
        ROW_REVEAL_WIDTH,
        inset.left,
        inset.width,
      ),
    ).toBe(false);
    // Left of the row: not its button, so the full guard applies.
    expect(
      touchStartsAtEdge(
        EDGE_GUARD_OPEN_BUTTON + 1,
        screen,
        ROW_REVEAL_WIDTH,
        EDGE_GUARD_OPEN_BUTTON + 4,
        inset.width,
      ),
    ).toBe(true);
    // A right-hand button follows the row's right edge (20 + 340 = 360), not the screen's (400).
    expect(
      touchStartsAtEdge(
        screen - 20,
        screen,
        -ROW_REVEAL_WIDTH,
        inset.left,
        inset.width,
      ),
    ).toBe(true);
    expect(
      touchStartsAtEdge(
        inset.left + inset.width - 10,
        screen,
        -ROW_REVEAL_WIDTH,
        inset.left,
        inset.width,
      ),
    ).toBe(false);
  });
});

describe("springArrivalMs", () => {
  const SNAPPY = { damping: 20, stiffness: 420, mass: 0.72 };

  /** An independent check: the same spring integrated step by step until its first arrival. */
  function integrate(
    spring: typeof SNAPPY,
    from: number,
    velocity: number,
  ): number {
    const dt = 0.0005;
    let x = from;
    let v = velocity;
    for (let step = 1; step < 4000; step++) {
      // Semi-implicit Euler is plenty at this step.
      v += ((-spring.stiffness * x - spring.damping * v) / spring.mass) * dt;
      x += v * dt;
      if (x * from <= 0 || Math.abs(x) < 0.01) return step * dt * 1000;
    }
    return SPRING_MAX_MS;
  }

  it("is nothing when the value starts at its target", () => {
    expect(springArrivalMs(SNAPPY, 0, 0)).toBe(0);
    expect(springArrivalMs(SNAPPY, 0.005, 500)).toBe(0);
  });

  it("takes the same time from any distance when it starts at rest", () => {
    const near = springArrivalMs(SNAPPY, 20, 0);
    const far = springArrivalMs(SNAPPY, 300, 0);
    expect(Math.abs(near - far)).toBeLessThanOrEqual(2);
    // The snappy preset reaches its target in about 110ms.
    expect(near).toBeGreaterThan(100);
    expect(near).toBeLessThan(125);
  });

  it("agrees with a numerical integration, whichever way the value is let go", () => {
    for (const [from, velocity] of [
      [88, 0],
      [-88, 0],
      [-70, -1500],
      [-70, 1500],
      [60, 3000],
      [90, -800],
    ]) {
      const expected = integrate(SNAPPY, from, velocity);
      expect(
        Math.abs(springArrivalMs(SNAPPY, from, velocity) - expected),
      ).toBeLessThanOrEqual(6);
    }
  });

  it("is shorter with a velocity toward the target and longer with one away from it", () => {
    const rest = springArrivalMs(SNAPPY, 80, 0);
    expect(springArrivalMs(SNAPPY, 80, -1500)).toBeLessThan(rest);
    expect(springArrivalMs(SNAPPY, 80, 1500)).toBeGreaterThan(rest);
    // A hard fling away adds a good fraction of the trip from rest: nothing may assume a fixed time.
    expect(springArrivalMs(SNAPPY, 80, 4000)).toBeGreaterThan(rest + 20);
  });

  it("follows a softer spring and a heavily damped one", () => {
    const gentle = { damping: 19, stiffness: 200, mass: 1 };
    expect(springArrivalMs(gentle, 80, 0)).toBeGreaterThan(
      springArrivalMs(SNAPPY, 80, 0),
    );
    expect(
      Math.abs(springArrivalMs(gentle, 80, 0) - integrate(gentle, 80, 0)),
    ).toBeLessThanOrEqual(6);
    // Critically damped and over-damped springs never cross: they stop when close enough.
    const critical = { damping: 2 * Math.sqrt(200), stiffness: 200, mass: 1 };
    const heavy = { damping: 60, stiffness: 200, mass: 1 };
    for (const spring of [critical, heavy]) {
      const arrival = springArrivalMs(spring, 80, 0);
      expect(arrival).toBeGreaterThan(0);
      expect(arrival).toBeLessThanOrEqual(SPRING_MAX_MS);
      expect(Math.abs(arrival - integrate(spring, 80, 0))).toBeLessThanOrEqual(
        10,
      );
    }
  });

  it("gives up at its cap for a spring that cannot be solved", () => {
    expect(springArrivalMs({ damping: 20, stiffness: 0, mass: 1 }, 80, 0)).toBe(
      SPRING_MAX_MS,
    );
  });
});
