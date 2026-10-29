import {
  canStep,
  landedOffset,
  pagePosition,
} from "@/components/ui/month-pager/pager-motion";

const W = 400;

describe("landedOffset", () => {
  it("keeps every page where it is on screen, whatever the direction and locale", () => {
    for (const sign of [1, -1] as const) {
      for (const direction of [1, -1] as const) {
        for (const translateX of [0, -120, 80, -400, 400]) {
          const base = 2400;
          const after = landedOffset(translateX, direction, sign, W);
          for (const index of [base - 1, base, base + 1, base + 2]) {
            expect(pagePosition(index, base + direction, sign, W, after)).toBe(
              pagePosition(index, base, sign, W, translateX),
            );
          }
        }
      }
    }
  });

  it("leaves a residual, not zero, when a slide is landed part-way", () => {
    // Forward slide (left in LTR) grabbed 40% across: the new centre sits 60% of a page right.
    expect(landedOffset(-0.4 * W, 1, 1, W)).toBeCloseTo(0.6 * W);
    // A slide landed at its end has no residual.
    expect(landedOffset(-W, 1, 1, W)).toBe(0);
    expect(landedOffset(W, 1, -1, W)).toBe(0);
  });

  it("starts a second slide from the residual and lands it exactly on the page", () => {
    // Two quick taps: the first lands 40% across, the second slides from there to the next page.
    const residual = landedOffset(-0.4 * W, 1, 1, W);
    expect(residual).toBeCloseTo(0.6 * W);
    // The target of the second slide is a whole page left; landing it re-bases to rest.
    expect(landedOffset(-W, 1, 1, W)).toBe(0);
  });
});

describe("canStep", () => {
  it("always allows back", () => {
    expect(canStep(-1, 100, 0, 100)).toBe(true);
    expect(canStep(-1, 100, 1, 100)).toBe(true);
  });

  it("allows forward up to the newest month, counting a slide in flight", () => {
    expect(canStep(1, 99, 0, 100)).toBe(true);
    expect(canStep(1, 100, 0, 100)).toBe(false);
    expect(canStep(1, 99, 1, 100)).toBe(false);
    expect(canStep(1, 99, -1, 100)).toBe(true);
    expect(canStep(1, 100, 0, Infinity)).toBe(true);
  });
});
