import { commitSpring, resolveSwipe } from "@/components/ui/resolve-swipe";

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
