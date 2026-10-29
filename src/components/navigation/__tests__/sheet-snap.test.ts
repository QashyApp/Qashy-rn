import {
  resolveSheetRelease,
  sheetDismissTiming,
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

describe("sheetDismissTiming", () => {
  it("carries a thrown sheet on at its release speed", () => {
    // 400 px at 2000 px/s is 200 ms, and a throw keeps its pace instead of accelerating.
    expect(sheetDismissTiming(400, 2000)).toEqual({
      duration: 200,
      linear: true,
    });
  });

  it("keeps the duration between 120 and 240 ms", () => {
    expect(sheetDismissTiming(100, 5000).duration).toBe(120);
    expect(sheetDismissTiming(900, 1000).duration).toBe(240);
  });

  it("lets a slow release take the exit curve", () => {
    expect(sheetDismissTiming(300, 0)).toEqual({
      duration: 240,
      linear: false,
    });
    expect(sheetDismissTiming(80, 200)).toEqual({
      duration: 200,
      linear: false,
    });
    expect(sheetDismissTiming(300, -50).linear).toBe(false);
  });
});
