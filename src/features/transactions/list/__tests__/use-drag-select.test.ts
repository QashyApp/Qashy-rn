import { PointerType } from "react-native-gesture-handler";

import {
  clampScrollTarget,
  edgeScrollStep,
  grabsSelectedOnPress,
  longPressPlan,
  maxScrollOffset,
} from "@/features/transactions/list/use-drag-select";

const TOP = 100;
const BOTTOM = 700;

describe("edgeScrollStep", () => {
  it("is zero away from both edges", () => {
    expect(edgeScrollStep(400, TOP, BOTTOM)).toBe(0);
    // Exactly at the edge of the 72dp zone.
    expect(edgeScrollStep(TOP + 72, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollStep(BOTTOM - 72, TOP, BOTTOM)).toBe(0);
  });

  it("eases in over the first 24dp of the zone", () => {
    expect(edgeScrollStep(TOP + 72 - 6, TOP, BOTTOM)).toBeCloseTo(-2);
    expect(edgeScrollStep(TOP + 72 - 12, TOP, BOTTOM)).toBeCloseTo(-4);
    expect(edgeScrollStep(BOTTOM - 72 + 12, TOP, BOTTOM)).toBeCloseTo(4);
  });

  it("holds the full 8dp step from 24dp in to the very edge", () => {
    expect(edgeScrollStep(TOP + 72 - 24, TOP, BOTTOM)).toBeCloseTo(-8);
    expect(edgeScrollStep(TOP + 10, TOP, BOTTOM)).toBeCloseTo(-8);
    expect(edgeScrollStep(BOTTOM - 10, TOP, BOTTOM)).toBeCloseTo(8);
  });

  it("never exceeds 8dp, even with the finger past the edge", () => {
    expect(edgeScrollStep(TOP - 300, TOP, BOTTOM)).toBe(-8);
    expect(edgeScrollStep(BOTTOM + 300, TOP, BOTTOM)).toBe(8);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(edgeScrollStep(TOP + 20, TOP, BOTTOM)).toBeLessThan(0);
    expect(edgeScrollStep(BOTTOM - 20, TOP, BOTTOM)).toBeGreaterThan(0);
  });
});

describe("grabsSelectedOnPress", () => {
  it("grabs a selected row for a mouse on the web", () => {
    expect(grabsSelectedOnPress(PointerType.MOUSE, true)).toBe(true);
  });

  it("leaves a finger, a pen and an unknown pointer to scroll", () => {
    expect(grabsSelectedOnPress(PointerType.TOUCH, true)).toBe(false);
    expect(grabsSelectedOnPress(PointerType.STYLUS, true)).toBe(false);
    expect(grabsSelectedOnPress(undefined, true)).toBe(false);
  });

  it("never grabs off the web", () => {
    expect(grabsSelectedOnPress(PointerType.MOUSE, false)).toBe(false);
  });
});

describe("maxScrollOffset", () => {
  it("is the content less the viewport", () => {
    expect(maxScrollOffset(2000, 600)).toBe(1400);
  });

  it("is zero for content that fits", () => {
    expect(maxScrollOffset(400, 600)).toBe(0);
  });

  it("is unlimited until both sizes are known", () => {
    expect(maxScrollOffset(0, 600)).toBe(Infinity);
    expect(maxScrollOffset(2000, 0)).toBe(Infinity);
  });
});

describe("clampScrollTarget", () => {
  it("leaves a target inside the list alone", () => {
    expect(clampScrollTarget(300, 1400)).toBe(300);
  });

  it("stops at the end of the list, however long the finger stays at the edge", () => {
    let target = 1392;
    for (let tick = 0; tick < 100; tick++)
      target = clampScrollTarget(target + 8, 1400);
    expect(target).toBe(1400);
  });

  it("stops at the top", () => {
    expect(clampScrollTarget(-8, 1400)).toBe(0);
  });

  it("does not limit a list whose size is not known", () => {
    expect(clampScrollTarget(5000, Infinity)).toBe(5000);
  });
});

describe("longPressPlan", () => {
  it("selects a row that is not selected and arms a drag from it, everywhere", () => {
    expect(longPressPlan(false, false)).toEqual({ toggle: true, arm: true });
    expect(longPressPlan(false, true)).toEqual({ toggle: true, arm: true });
  });

  it("deselects a selected row on native, with nothing to drag from", () => {
    expect(longPressPlan(true, false)).toEqual({ toggle: true, arm: false });
  });

  it("holds a selected row on the web, so a finger can drag from it", () => {
    expect(longPressPlan(true, true)).toEqual({ toggle: false, arm: true });
  });
});
