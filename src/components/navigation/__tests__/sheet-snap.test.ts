import {
  resolveSheetRelease,
  sheetSpring,
} from "@/components/navigation/sheet-snap";

const heights = { collapsed: 600, expanded: 900 };

describe("resolveSheetRelease", () => {
  it("settles back on the collapsed height after a small pull down", () => {
    expect(
      resolveSheetRelease({ visible: 560, velocityY: 0, ...heights }),
    ).toEqual({ kind: "snap", detent: "collapsed" });
  });

  it("dismisses once pulled below half the collapsed height", () => {
    expect(
      resolveSheetRelease({ visible: 250, velocityY: 0, ...heights }),
    ).toEqual({ kind: "dismiss" });
  });

  it("dismisses on a downward flick that started above that line", () => {
    expect(
      resolveSheetRelease({ visible: 500, velocityY: 2500, ...heights }),
    ).toEqual({ kind: "dismiss" });
  });

  it("expands past the midpoint, and on an upward flick", () => {
    expect(
      resolveSheetRelease({ visible: 780, velocityY: 0, ...heights }),
    ).toEqual({ kind: "snap", detent: "expanded" });
    expect(
      resolveSheetRelease({ visible: 640, velocityY: -2000, ...heights }),
    ).toEqual({ kind: "snap", detent: "expanded" });
  });

  it("falls back from expanded to collapsed on a moderate pull down", () => {
    expect(
      resolveSheetRelease({ visible: 700, velocityY: 0, ...heights }),
    ).toEqual({ kind: "snap", detent: "collapsed" });
  });

  it("never expands when there is no taller height", () => {
    expect(
      resolveSheetRelease({
        visible: 600,
        velocityY: -4000,
        collapsed: 600,
        expanded: 600,
      }),
    ).toEqual({ kind: "snap", detent: "collapsed" });
  });
});

describe("sheetSpring", () => {
  it("is clamped and underdamped by the requested ratio", () => {
    const spring = sheetSpring(0.86, 560);
    expect(spring.overshootClamping).toBe(true);
    // ζ = c / (2·√(k·m))
    expect(
      spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass)),
    ).toBeCloseTo(0.86, 6);
  });

  it("settles faster with a shorter duration", () => {
    expect(sheetSpring(0.86, 400).stiffness).toBeGreaterThan(
      sheetSpring(0.86, 560).stiffness,
    );
  });
});
