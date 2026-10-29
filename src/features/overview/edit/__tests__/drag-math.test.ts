import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_STEP,
  autoScrollStep,
  clampScroll,
  dropTargetIndex,
  insertionLineY,
  resolveDropTarget,
  slotsFromHeights,
  stickyDropTarget,
} from "@/features/overview/edit/drag-math";

// Four cards of height 100 with a 20 gap: tops 0, 120, 240, 360; midpoints 50, 170, 290, 410.
const slots = slotsFromHeights([100, 100, 100, 100], 20);

describe("slotsFromHeights", () => {
  it("stacks heights with the gap between neighbours", () => {
    expect(slots).toEqual([
      { top: 0, height: 100 },
      { top: 120, height: 100 },
      { top: 240, height: 100 },
      { top: 360, height: 100 },
    ]);
  });

  it("copes with different heights and with no cards", () => {
    expect(slotsFromHeights([40, 200], 10)).toEqual([
      { top: 0, height: 40 },
      { top: 50, height: 200 },
    ]);
    expect(slotsFromHeights([], 10)).toEqual([]);
  });
});

describe("dropTargetIndex", () => {
  it("stays put while the dragged midpoint is in its own slot", () => {
    expect(dropTargetIndex(slots, 1, 170)).toBe(1);
    expect(dropTargetIndex(slots, 1, 120)).toBe(1);
    expect(dropTargetIndex(slots, 1, 230)).toBe(1);
  });

  it("moves down once the midpoint passes a neighbour's midpoint", () => {
    expect(dropTargetIndex(slots, 1, 289)).toBe(1);
    expect(dropTargetIndex(slots, 1, 291)).toBe(2);
    expect(dropTargetIndex(slots, 0, 500)).toBe(3);
  });

  it("moves up once the midpoint passes a neighbour's midpoint", () => {
    expect(dropTargetIndex(slots, 2, 171)).toBe(2);
    expect(dropTargetIndex(slots, 2, 169)).toBe(1);
    expect(dropTargetIndex(slots, 3, -400)).toBe(0);
  });

  it("includes how far the page has scrolled under the finger", () => {
    // Holding card 0 still while the page scrolls 260px: its midpoint is now at 310.
    expect(dropTargetIndex(slots, 0, 50 + 260)).toBe(2);
  });

  it("accounts for cards of different heights", () => {
    const mixed = slotsFromHeights([300, 60, 60], 20);
    // Midpoints: 150, 350, 430.
    expect(dropTargetIndex(mixed, 1, 100)).toBe(0);
    expect(dropTargetIndex(mixed, 0, 400)).toBe(1);
  });
});

describe("insertionLineY", () => {
  it("is hidden when nothing is dragged or the card would not move", () => {
    expect(insertionLineY(slots, -1, -1, 20)).toBeNull();
    expect(insertionLineY(slots, 1, 1, 20)).toBeNull();
    expect(insertionLineY(slots, 1, -1, 20)).toBeNull();
    expect(insertionLineY(slots, 1, 9, 20)).toBeNull();
  });

  it("sits in the gap above the card it moves in front of", () => {
    expect(insertionLineY(slots, 3, 1, 20)).toBe(110);
    expect(insertionLineY(slots, 2, 0, 20)).toBe(-10);
  });

  it("sits in the gap below the card it moves behind", () => {
    expect(insertionLineY(slots, 0, 2, 20)).toBe(350);
    expect(insertionLineY(slots, 1, 3, 20)).toBe(470);
  });
});

describe("autoScrollStep", () => {
  const top = 100;
  const height = 600;

  it("is zero away from both edges", () => {
    expect(autoScrollStep(400, top, height)).toBe(0);
    expect(autoScrollStep(top + AUTO_SCROLL_EDGE, top, height)).toBe(0);
    expect(autoScrollStep(top + height - AUTO_SCROLL_EDGE, top, height)).toBe(
      0,
    );
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(autoScrollStep(top + 40, top, height)).toBeLessThan(0);
    expect(autoScrollStep(top + height - 40, top, height)).toBeGreaterThan(0);
  });

  it("eases in: half way into the zone is a quarter of the cap", () => {
    expect(autoScrollStep(top + 40, top, height)).toBeCloseTo(
      -AUTO_SCROLL_MAX_STEP / 4,
    );
    expect(autoScrollStep(top + height - 40, top, height)).toBeCloseTo(
      AUTO_SCROLL_MAX_STEP / 4,
    );
  });

  it("never exceeds the cap, even with the finger past the edge", () => {
    expect(autoScrollStep(top, top, height)).toBe(-AUTO_SCROLL_MAX_STEP);
    expect(autoScrollStep(top - 300, top, height)).toBe(-AUTO_SCROLL_MAX_STEP);
    expect(autoScrollStep(top + height + 300, top, height)).toBe(
      AUTO_SCROLL_MAX_STEP,
    );
  });

  it("does nothing before the viewport has been measured", () => {
    expect(autoScrollStep(0, 0, 0)).toBe(0);
  });

  it("keeps the two zones apart on a very short viewport", () => {
    // 90px tall: each zone is 30px, so the middle third is still still.
    expect(autoScrollStep(45, 0, 90)).toBe(0);
  });
});

describe("clampScroll", () => {
  it("keeps the offset inside the content", () => {
    expect(clampScroll(-20, 500)).toBe(0);
    expect(clampScroll(200, 500)).toBe(200);
    expect(clampScroll(900, 500)).toBe(500);
    expect(clampScroll(10, 0)).toBe(0);
  });
});

describe("resolveDropTarget", () => {
  const base = {
    phase: 1,
    slots,
    index: 1,
    panY: 0,
    scrollY: 0,
    scrollAtStart: 0,
  };

  it("is -1 when no drag is live or the card has no slot", () => {
    expect(resolveDropTarget({ ...base, phase: 0 })).toBe(-1);
    expect(resolveDropTarget({ ...base, index: 9 })).toBe(-1);
    expect(resolveDropTarget({ ...base, slots: [] })).toBe(-1);
  });

  it("stays on its own index while held in place", () => {
    expect(resolveDropTarget(base)).toBe(1);
  });

  it("follows the finger down and up", () => {
    // Card 1's midpoint is 170; +130 puts it at 300, past cards 0 and 2 (50, 290).
    expect(resolveDropTarget({ ...base, panY: 130 })).toBe(2);
    expect(resolveDropTarget({ ...base, panY: -130 })).toBe(0);
    expect(resolveDropTarget({ ...base, panY: 300 })).toBe(3);
  });

  it("counts the page scrolling under a still finger", () => {
    expect(resolveDropTarget({ ...base, scrollY: 130 })).toBe(2);
    expect(resolveDropTarget({ ...base, scrollY: -130 })).toBe(0);
  });

  it("only counts scroll since the drag began", () => {
    // Already scrolled 500 when the drag started: no movement yet.
    expect(
      resolveDropTarget({ ...base, scrollY: 500, scrollAtStart: 500 }),
    ).toBe(1);
    expect(
      resolveDropTarget({ ...base, scrollY: 630, scrollAtStart: 500 }),
    ).toBe(2);
  });

  it("adds finger travel and scroll together", () => {
    // 60 of drag plus 70 of scroll is the same 130 as either alone.
    expect(resolveDropTarget({ ...base, panY: 60, scrollY: 70 })).toBe(2);
    // Dragging up while the page scrolls down cancels out.
    expect(resolveDropTarget({ ...base, panY: -130, scrollY: 130 })).toBe(1);
  });
});

describe("stickyDropTarget", () => {
  // Dragging card 1: the others' midpoints are 50, 290 and 410, and the margin is a quarter of
  // their height (25), so the target moves down past 315 / 435 and back up below 265 / 385.
  it("behaves like dropTargetIndex when there is no current target", () => {
    expect(stickyDropTarget(slots, 1, 300, -1)).toBe(2);
    expect(stickyDropTarget(slots, 1, 289, -1)).toBe(1);
    expect(stickyDropTarget(slots, 1, 300, 99)).toBe(2);
  });

  it("holds the target until the midpoint is passed by the margin, going down", () => {
    expect(stickyDropTarget(slots, 1, 291, 1)).toBe(1);
    expect(stickyDropTarget(slots, 1, 315, 1)).toBe(1);
    expect(stickyDropTarget(slots, 1, 316, 1)).toBe(2);
  });

  it("holds the target until the midpoint is passed by the margin, going up", () => {
    expect(stickyDropTarget(slots, 1, 49, 1)).toBe(1);
    // Card 0's midpoint is 50, so it flips back only below 25.
    expect(stickyDropTarget(slots, 1, 26, 1)).toBe(1);
    expect(stickyDropTarget(slots, 1, 24, 1)).toBe(0);
  });

  it("does not flicker when the card hovers around a midpoint", () => {
    let current = 1;
    const seen: number[] = [];
    for (const center of [285, 295, 288, 310, 292, 314, 291]) {
      current = stickyDropTarget(slots, 1, center, current);
      seen.push(current);
    }
    expect(seen).toEqual([1, 1, 1, 1, 1, 1, 1]);

    // Once clearly across, it holds the new slot over the same wobble.
    current = stickyDropTarget(slots, 1, 330, current);
    expect(current).toBe(2);
    for (const center of [295, 310, 270, 300]) {
      current = stickyDropTarget(slots, 1, center, current);
      expect(current).toBe(2);
    }
    expect(stickyDropTarget(slots, 1, 264, current)).toBe(1);
  });

  it("crosses several slots at once for a fast move", () => {
    expect(stickyDropTarget(slots, 1, 500, 1)).toBe(3);
    expect(stickyDropTarget(slots, 1, 100, 3)).toBe(1);
    expect(stickyDropTarget(slots, 1, -400, 3)).toBe(0);
  });

  it("scales the margin with the neighbour's height", () => {
    const mixed = slotsFromHeights([300, 60, 60], 20);
    // Dragging card 1 (mid 350) up past card 0 (mid 150, margin 75): flips below 75.
    expect(stickyDropTarget(mixed, 1, 100, 1)).toBe(1);
    expect(stickyDropTarget(mixed, 1, 74, 1)).toBe(0);
  });

  it("returns a result that is stable when fed back in", () => {
    for (const center of [-100, 40, 200, 290, 316, 436, 700]) {
      for (const current of [-1, 0, 1, 2, 3]) {
        const once = stickyDropTarget(slots, 1, center, current);
        expect(stickyDropTarget(slots, 1, center, once)).toBe(once);
      }
    }
  });
});

describe("resolveDropTarget with a current target", () => {
  const base = {
    phase: 1,
    slots,
    index: 1,
    panY: 0,
    scrollY: 0,
    scrollAtStart: 0,
  };

  it("sticks to the current target near a midpoint", () => {
    expect(resolveDropTarget({ ...base, panY: 130, current: 1 })).toBe(1);
    expect(resolveDropTarget({ ...base, panY: 150, current: 1 })).toBe(2);
    expect(resolveDropTarget({ ...base, panY: 130, current: 2 })).toBe(2);
    expect(resolveDropTarget({ ...base, panY: 130 })).toBe(2);
  });

  it("is still -1 without a live drag", () => {
    expect(resolveDropTarget({ ...base, phase: 0, current: 1 })).toBe(-1);
  });
});
