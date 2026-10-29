import { PointerType } from "react-native-gesture-handler";

import {
  edgeScrollStep,
  grabsSelectedOnPress,
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
