import {
  commitSpring,
  resolveRelease,
  resolveSwipe,
} from "@/components/ui/resolve-swipe";

const W = 400;

describe("resolveSwipe", () => {
  it("springs back below the distance threshold at low speed", () => {
    expect(resolveSwipe(-99, 0, W, true, false)).toBe(0);
    expect(resolveSwipe(99, 100, W, true, false)).toBe(0);
  });

  it("is armed exactly at the distance threshold, which the pager ticks on", () => {
    expect(resolveSwipe(-99.9, 0, W, true, false)).toBe(0);
    expect(resolveSwipe(-100, 0, W, true, false)).toBe(1);
    expect(resolveSwipe(-100, 0, W, false, false)).toBe(0);
  });

  it("commits at a quarter of the width", () => {
    expect(resolveSwipe(-100, 0, W, true, false)).toBe(1);
    expect(resolveSwipe(100, 0, W, true, false)).toBe(-1);
  });

  it("commits a short flick", () => {
    expect(resolveSwipe(-30, -850, W, true, false)).toBe(1);
    expect(resolveSwipe(30, 900, W, true, false)).toBe(-1);
    expect(resolveSwipe(-30, -849, W, true, false)).toBe(0);
  });

  it("needs a flick to have travelled before it commits", () => {
    expect(resolveSwipe(-28, -2000, W, true, false)).toBe(1);
    expect(resolveSwipe(-27, -2000, W, true, false)).toBe(0);
    expect(resolveSwipe(10, 2000, W, true, false)).toBe(0);
  });

  it("lets a flick override the drag direction", () => {
    expect(resolveSwipe(-250, 900, W, true, false)).toBe(-1);
  });

  it("mirrors in right-to-left locales", () => {
    expect(resolveSwipe(-150, 0, W, true, true)).toBe(-1);
    expect(resolveSwipe(150, 0, W, true, true)).toBe(1);
    expect(resolveSwipe(40, 900, W, true, true)).toBe(1);
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

describe("resolveRelease", () => {
  it("is resolveSwipe for a drag that began at rest", () => {
    for (const [dx, vx] of [
      [-99, 0],
      [-100, 0],
      [100, 0],
      [-30, -850],
      [30, 900],
      [-250, 900],
    ] as const) {
      expect(resolveRelease(0, dx, vx, W, true, false)).toBe(
        resolveSwipe(dx, vx, W, true, false),
      );
      expect(resolveRelease(0, dx, vx, W, true, true)).toBe(
        resolveSwipe(dx, vx, W, true, true),
      );
    }
  });

  it("settles on the landed month when a grabbed slide is dragged the same way, slowly", () => {
    // Swiped left, grabbed ~80 ms in: the landed month sits 200 px right of centre. A slow 100 px
    // drag left puts the pages at 100, where resolveSwipe alone would go back a month.
    expect(resolveSwipe(200 - 100, 0, W, true, false)).toBe(-1);
    expect(resolveRelease(200, -100, 0, W, true, false)).toBe(0);
    // Still the same way, only a little: the same.
    expect(resolveRelease(360, -40, -100, W, true, false)).toBe(0);
    expect(resolveRelease(360, -150, -100, W, true, false)).toBe(0);
  });

  it("settles the same way in right-to-left locales", () => {
    expect(resolveRelease(-200, 100, 0, W, true, true)).toBe(0);
    expect(resolveRelease(-360, 40, 100, W, true, true)).toBe(0);
  });

  it("goes on to the next month when the drag the same way carries on past the landed one", () => {
    expect(resolveRelease(200, -320, 0, W, true, false)).toBe(1);
    expect(resolveRelease(200, -60, -1200, W, true, false)).toBe(1);
  });

  it("does not go on to a month that is not allowed", () => {
    expect(resolveRelease(200, -320, 0, W, false, false)).toBe(0);
    expect(resolveRelease(200, -60, -1200, W, false, false)).toBe(0);
  });

  it("lets a drag the other way go back, as the finger moved", () => {
    expect(resolveRelease(200, 30, 0, W, true, false)).toBe(-1);
    expect(resolveRelease(200, 30, 900, W, true, false)).toBe(-1);
  });

  it("never commits against a flick, whatever the offset", () => {
    // Pages are 230 px right of centre, the flick is leftward.
    expect(resolveRelease(200, 30, -1000, W, true, false)).toBe(1);
  });

  it("does not commit forward when a caught spring-back is nudged back toward rest", () => {
    // The pages were 120 px toward the next month; the finger moved 20 px the other way.
    expect(resolveSwipe(-120 + 20, 0, W, true, false)).toBe(1);
    expect(resolveRelease(-120, 20, 0, W, true, false)).toBe(0);
    // Nudged the same way it still commits.
    expect(resolveRelease(-120, -20, 0, W, true, false)).toBe(1);
  });

  it("settles on the nearest page on the finger's side, not always the centre", () => {
    // Pages 340 px right of centre (the landed month is mostly off), finger moving left 10 px:
    // the page at the centre is the nearest one on that side.
    expect(resolveRelease(340, -10, 0, W, true, false)).toBe(0);
    // Past a whole page the other way, the nearest page leftward is the next month.
    expect(resolveRelease(-380, -30, 0, W, true, false)).toBe(1);
    // ...unless that month is not allowed, when nothing is on the finger's side but where it is.
    expect(resolveRelease(-380, -30, 0, W, false, false)).toBe(0);
  });

  it("does not let a grab's residual offset pass a jittery tap as a flick", () => {
    // Pages 200 px left of centre, a 5 px finger movement at a high release speed: a tap.
    expect(resolveSwipe(-200 + 5, 1200, W, true, false)).toBe(-1);
    expect(resolveRelease(-200, 5, 1200, W, true, false)).toBe(0);
    expect(resolveRelease(-200, 5, 1200, W, true, true)).toBe(0);
    // The same speed with real travel still flicks.
    expect(resolveRelease(-200, 28, 1200, W, true, false)).toBe(-1);
    expect(resolveRelease(100, -28, -1200, W, true, false)).toBe(1);
  });

  it("settles on the nearest page, in any direction, when the finger did not move", () => {
    // Pages 300 px right of centre: the page at +W is nearest, whichever way that is.
    expect(resolveRelease(300, 0, 0, W, true, false)).toBe(-1);
    expect(resolveRelease(-300, 0, 0, W, true, false)).toBe(1);
    expect(resolveRelease(-300, 0, 0, W, false, false)).toBe(0);
    expect(resolveRelease(100, 0, 0, W, true, false)).toBe(0);
    expect(resolveRelease(-120, 0, 900, W, true, false)).toBe(0);
    // Right-to-left mirrors it.
    expect(resolveRelease(-300, 0, 0, W, true, true)).toBe(-1);
    expect(resolveRelease(300, 0, 0, W, true, true)).toBe(1);
    // Halfway between two pages goes to the current one.
    expect(resolveRelease(200, 0, 0, W, true, false)).toBe(0);
    expect(resolveRelease(-200, 0, 0, W, true, false)).toBe(0);
  });

  it("keeps a zero-width page and a motionless finger quiet", () => {
    expect(resolveRelease(100, -50, 0, 0, true, false)).toBe(0);
    expect(resolveRelease(0, 0, 0, W, true, false)).toBe(0);
  });
});
