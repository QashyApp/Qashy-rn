import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_STEP,
  autoScrollStep,
  clampScroll,
  dropTargetIndex,
  insertionLineY,
  slotsFromHeights,
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
