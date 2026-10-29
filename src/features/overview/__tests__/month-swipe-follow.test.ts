import {
  monthSwipeFollow,
  SWIPE_FOLLOW_MIN_OPACITY,
  SWIPE_FOLLOW_TRAVEL,
} from "@/features/overview/month-swipe-follow";

describe("monthSwipeFollow", () => {
  it("is at rest with no swipe", () => {
    expect(monthSwipeFollow(0, 400, "travel")).toEqual({
      translateX: 0,
      opacity: 1,
    });
  });

  it("leans toward the finger on either side and dims with progress", () => {
    const left = monthSwipeFollow(-0.5, 400, "travel");
    const right = monthSwipeFollow(0.5, 400, "travel");
    expect(left.translateX).toBeLessThan(0);
    expect(right.translateX).toBeGreaterThan(0);
    expect(left.translateX).toBeCloseTo(-right.translateX);
    expect(left.opacity).toBeLessThan(1);
    expect(left.opacity).toBeCloseTo(right.opacity);
  });

  it("follows at a fraction of the finger's travel", () => {
    // Early in the swipe the lean is close to the full fraction of the finger's distance.
    const follow = monthSwipeFollow(0.1, 400, "travel");
    expect(follow.translateX).toBeGreaterThan(0);
    expect(follow.translateX).toBeLessThanOrEqual(
      0.1 * 400 * SWIPE_FOLLOW_TRAVEL,
    );
  });

  it("comes back to centre, and to the dimmed floor, as the swipe completes", () => {
    const done = monthSwipeFollow(-1, 400, "travel");
    expect(done.translateX).toBeCloseTo(0);
    expect(done.opacity).toBeCloseTo(SWIPE_FOLLOW_MIN_OPACITY);
  });

  it("clamps a drag beyond a full page", () => {
    expect(monthSwipeFollow(3, 400, "travel")).toEqual(
      monthSwipeFollow(1, 400, "travel"),
    );
  });

  it("only fades at the minimal level", () => {
    const follow = monthSwipeFollow(0.5, 400, "fade");
    expect(follow.translateX).toBe(0);
    expect(follow.opacity).toBeLessThan(1);
  });

  it("does nothing when motion is off or reduced", () => {
    expect(monthSwipeFollow(0.7, 400, "none")).toEqual({
      translateX: 0,
      opacity: 1,
    });
  });
});
