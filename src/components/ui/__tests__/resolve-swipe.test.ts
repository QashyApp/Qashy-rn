import {
  BLOCKED_FOLLOW,
  NO_MAX_INDEX,
  commitSpring,
  followPosition,
  monthFromIndex,
  monthIndex,
  resolveSwipe,
  swipeDisplacement,
} from "@/components/ui/resolve-swipe";

const W = 400;

describe("resolveSwipe", () => {
  it("springs back below the distance threshold at low speed", () => {
    expect(resolveSwipe(-99, 0, W, true, false)).toBe(0);
    expect(resolveSwipe(99, 100, W, true, false)).toBe(0);
  });

  it("commits at a quarter of the width", () => {
    expect(resolveSwipe(-100, 0, W, true, false)).toBe(1);
    expect(resolveSwipe(100, 0, W, true, false)).toBe(-1);
  });

  it("commits a short flick", () => {
    expect(resolveSwipe(-10, -600, W, true, false)).toBe(1);
    expect(resolveSwipe(10, 650, W, true, false)).toBe(-1);
    expect(resolveSwipe(-10, -599, W, true, false)).toBe(0);
  });

  it("lets a flick override the drag direction", () => {
    expect(resolveSwipe(-250, 800, W, true, false)).toBe(-1);
  });

  it("mirrors in right-to-left locales", () => {
    expect(resolveSwipe(-150, 0, W, true, true)).toBe(-1);
    expect(resolveSwipe(150, 0, W, true, true)).toBe(1);
    expect(resolveSwipe(10, 900, W, true, true)).toBe(1);
  });

  it("refuses to go forward when blocked, but still goes back", () => {
    expect(resolveSwipe(-300, -900, W, false, false)).toBe(0);
    expect(resolveSwipe(300, 0, W, false, false)).toBe(-1);
    expect(resolveSwipe(300, 0, W, false, true)).toBe(0);
  });

  it("ignores a zero-width page and a motionless flick", () => {
    expect(resolveSwipe(-50, 0, 0, true, false)).toBe(0);
    expect(resolveSwipe(0, 0, W, true, false)).toBe(0);
  });
});

describe("commitSpring", () => {
  it("keeps the theme's stiffness and mass and damps critically", () => {
    const spring = { damping: 22, stiffness: 320, mass: 0.8 };
    const committed = commitSpring(spring);
    expect(committed.stiffness).toBe(320);
    expect(committed.mass).toBe(0.8);
    // ζ = c / (2·√(k·m)) = 1
    expect(
      committed.damping / (2 * Math.sqrt(committed.stiffness * committed.mass)),
    ).toBeCloseTo(1, 10);
  });
});

describe("monthIndex / monthFromIndex", () => {
  it("puts neighbouring months exactly one apart, across years", () => {
    expect(monthIndex("2026-01-01") - monthIndex("2025-12-01")).toBe(1);
    expect(monthIndex("2026-10-01") - monthIndex("2026-09-15")).toBe(1);
    expect(monthIndex("2026-10")).toBe(monthIndex("2026-10-31"));
  });

  it("round-trips to the first of the month", () => {
    for (const month of [
      "2025-12-01",
      "2026-01-01",
      "2026-10-01",
      "0999-07-01",
    ]) {
      expect(monthFromIndex(monthIndex(month))).toBe(month);
    }
    expect(monthFromIndex(monthIndex("2026-12-01") + 1)).toBe("2027-01-01");
    expect(monthFromIndex(monthIndex("2026-01-01") - 1)).toBe("2025-12-01");
  });
});

describe("followPosition", () => {
  const anchor = monthIndex("2026-10-01");

  it("follows the finger in page widths, forward to the left in LTR", () => {
    expect(followPosition(anchor, -100, W, false, anchor, NO_MAX_INDEX)).toBe(
      anchor + 0.25,
    );
    expect(followPosition(anchor, 100, W, false, anchor, NO_MAX_INDEX)).toBe(
      anchor - 0.25,
    );
  });

  it("mirrors in right-to-left locales", () => {
    expect(followPosition(anchor, 100, W, true, anchor, NO_MAX_INDEX)).toBe(
      anchor + 0.25,
    );
  });

  it("never strays more than a month from the anchor", () => {
    expect(followPosition(anchor, -900, W, false, anchor, NO_MAX_INDEX)).toBe(
      anchor + 1,
    );
    expect(followPosition(anchor, 900, W, false, anchor, NO_MAX_INDEX)).toBe(
      anchor - 1,
    );
    // A drag that caught a slide still short of its month is bounded by where it is heading.
    expect(
      followPosition(anchor - 0.4, -900, W, false, anchor, NO_MAX_INDEX),
    ).toBe(anchor + 1);
  });

  it("barely follows past the newest allowed month", () => {
    expect(followPosition(anchor, -200, W, false, anchor, anchor)).toBeCloseTo(
      anchor + 0.5 * BLOCKED_FOLLOW,
      10,
    );
    // Back is free.
    expect(followPosition(anchor, 200, W, false, anchor, anchor)).toBe(
      anchor - 0.5,
    );
  });

  it("holds still without a width", () => {
    expect(followPosition(anchor, -200, 0, false, anchor, NO_MAX_INDEX)).toBe(
      anchor,
    );
  });
});

describe("swipeDisplacement", () => {
  it("counts the whole offset, so a caught spring-back keeps its distance", () => {
    expect(swipeDisplacement(-120, -40, false)).toBe(-120);
  });

  it("counts only the finger once a committed slide was caught", () => {
    // Caught 30% short of the new month and let go: not a swipe back.
    const resolved = resolveSwipe(
      swipeDisplacement(0.3 * W, 0, true),
      0,
      W,
      true,
      false,
    );
    expect(resolved).toBe(0);
    // Pushed on another quarter: the next month.
    expect(
      resolveSwipe(
        swipeDisplacement(0.05 * W, -0.25 * W, true),
        0,
        W,
        true,
        false,
      ),
    ).toBe(1);
  });
});
