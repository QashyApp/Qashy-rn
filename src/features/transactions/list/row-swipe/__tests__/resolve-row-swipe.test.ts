import {
  COMMIT_RESISTANCE,
  DESTRUCTIVE_FLING_VELOCITY,
  EDGE_GUARD,
  EDGE_GUARD_OPEN_BUTTON,
  ICON_REST_SCALE,
  ROW_REVEAL_WIDTH,
  RUBBER_LIMIT,
  classifyMove,
  commitDistance,
  commitOffset,
  commitProgress,
  displayOffset,
  findRowAt,
  iconScale,
  isPastCommitLine,
  resolveRowSwipe,
  settleOffset,
  sideOf,
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
