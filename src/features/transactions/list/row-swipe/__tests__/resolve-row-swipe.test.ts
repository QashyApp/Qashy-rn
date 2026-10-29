import {
  ROW_REVEAL_WIDTH,
  RUBBER_LIMIT,
  commitDistance,
  commitOffset,
  displayOffset,
  findRowAt,
  isPastCommitLine,
  resolveRowSwipe,
  settleOffset,
  sideOf,
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
  } = {},
) {
  return resolveRowSwipe({
    offset,
    velocity,
    rowWidth: options.width ?? WIDTH,
    revealWidth: REVEAL,
    isRtl: options.isRtl ?? false,
    sides: options.sides ?? BOTH,
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
  it("follows the finger on an enabled side up to the row's width", () => {
    expect(displayOffset(50, WIDTH, false, BOTH)).toBe(50);
    expect(displayOffset(-200, WIDTH, false, BOTH)).toBe(-200);
    expect(displayOffset(WIDTH * 2, WIDTH, false, BOTH)).toBe(WIDTH);
    expect(displayOffset(-WIDTH * 2, WIDTH, false, BOTH)).toBe(-WIDTH);
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
