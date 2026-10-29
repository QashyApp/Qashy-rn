import {
  LANDED_TRAIL_LIMIT,
  canStep,
  judgeRender,
  landedOffset,
  pagePosition,
  planStep,
  pushLanded,
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

describe("pushLanded", () => {
  it("appends and forgets the oldest past the limit", () => {
    expect(pushLanded([11], 10)).toEqual([11, 10]);
    const full = Array.from({ length: LANDED_TRAIL_LIMIT }, (_, i) => i + 1);
    const next = pushLanded(full, 999);
    expect(next).toHaveLength(LANDED_TRAIL_LIMIT);
    expect(next[0]).toBe(2);
    expect(next.at(-1)).toBe(999);
    // Does not mutate its input.
    expect(full[0]).toBe(1);
  });
});

describe("judgeRender", () => {
  it("retires a render that caught up with the only slide", () => {
    expect(judgeRender(11, [11])).toEqual({
      external: false,
      caughtUp: true,
      trail: [],
    });
  });

  it("ignores the render of an earlier slide while a newer one is landed (forward then quick back)", () => {
    // Forward landed on 11, back landed on 10 before React rendered 11.
    const first = judgeRender(11, [11, 10]);
    expect(first).toEqual({ external: false, caughtUp: false, trail: [10] });
    const second = judgeRender(10, first.trail);
    expect(second).toEqual({ external: false, caughtUp: true, trail: [] });
  });

  it("retires every older entry when React skips straight to a later slide", () => {
    expect(judgeRender(12, [10, 11, 12])).toEqual({
      external: false,
      caughtUp: true,
      trail: [],
    });
    expect(judgeRender(11, [10, 11, 12])).toEqual({
      external: false,
      caughtUp: false,
      trail: [12],
    });
  });

  it("treats a month the pager never landed on as an external jump, even inside the run's range", () => {
    // A picker jump to 5 or to 10.5-ish gaps: anything not landed on.
    expect(judgeRender(5, [11, 10])).toEqual({
      external: true,
      caughtUp: true,
      trail: [],
    });
    // Between two landed months, never landed on itself (the old range test accepted this).
    expect(judgeRender(11, [10, 12])).toEqual({
      external: true,
      caughtUp: true,
      trail: [],
    });
  });

  it("treats any render with an empty trail as external", () => {
    expect(judgeRender(7, []).external).toBe(true);
  });

  it("cannot tell a jump to a month still in the trail from the pager's own render (documented limit)", () => {
    // Forward then back were coalesced into no render, leaving [11, 10]. A picker jump to 10 within
    // the commit timeout is absorbed as the pager's own; the timeout reconciles the pages later.
    expect(judgeRender(10, [11, 10])).toEqual({
      external: false,
      caughtUp: true,
      trail: [],
    });
    expect(judgeRender(11, [11, 10])).toEqual({
      external: false,
      caughtUp: false,
      trail: [10],
    });
  });

  it("matches a repeated month at its oldest entry", () => {
    // Forward, back, forward again: 11, 10, 11.
    expect(judgeRender(11, [11, 10, 11])).toEqual({
      external: false,
      caughtUp: false,
      trail: [10, 11],
    });
  });
});

describe("planStep", () => {
  it("slides whenever the pages beside it are mounted and the pager is enabled", () => {
    expect(planStep(true, false, true)).toBe("slide");
  });

  it("asks React for the month rather than landing on a page that is not mounted", () => {
    // Disabled (neighbours are never mounted) or the neighbours are off.
    expect(planStep(true, true, false)).toBe("ask");
    expect(planStep(true, true, true)).toBe("ask");
    expect(planStep(true, false, false)).toBe("ask");
  });

  it("only drives the title when there are no pages", () => {
    expect(planStep(false, false, false)).toBe("slide");
    expect(planStep(false, true, false)).toBe("land");
  });
});
