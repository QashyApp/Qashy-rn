import {
  WHEEL_QUIET,
  WHEEL_STEP,
  wheelPixels,
  wheelStep,
  type WheelGesture,
} from "@/components/ui/month-pager/wheel-step";

/** Feeds `deltas` through, returning each step taken and the gesture left. */
function feed(deltas: number[], sign: 1 | -1 = 1, busy = false) {
  let gesture: WheelGesture = WHEEL_QUIET;
  const steps: number[] = [];
  for (const dx of deltas) {
    const next = wheelStep(gesture, dx, sign, busy);
    gesture = next.gesture;
    if (next.direction !== 0) steps.push(next.direction);
  }
  return { steps, gesture };
}

describe("wheelPixels", () => {
  it("converts lines and pages to pixels", () => {
    expect(wheelPixels(0, 10)).toBe(10);
    expect(wheelPixels(1, 3)).toBe(48);
    expect(wheelPixels(2, 1)).toBe(400);
  });
});

describe("wheelStep", () => {
  it("steps once the distance is reached, not before", () => {
    expect(feed([WHEEL_STEP - 1]).steps).toEqual([]);
    expect(feed([WHEEL_STEP]).steps).toEqual([1]);
    expect(feed([-WHEEL_STEP]).steps).toEqual([-1]);
  });

  it("accumulates small deltas across events", () => {
    expect(feed([10, 10, 10, 10]).steps).toEqual([1]);
    expect(feed([-15, -15, -15]).steps).toEqual([-1]);
  });

  it("lets opposing deltas cancel", () => {
    expect(feed([30, -30, 30, -30]).steps).toEqual([]);
  });

  it("flips in right-to-left locales", () => {
    expect(feed([WHEEL_STEP], -1).steps).toEqual([-1]);
    expect(feed([-WHEEL_STEP], -1).steps).toEqual([1]);
  });

  it("takes one step per gesture however long the inertia runs", () => {
    const { steps, gesture } = feed([50, 30, 20, 10, 5, 80, -90]);
    expect(steps).toEqual([1]);
    expect(gesture.latched).toBe(true);
  });

  it("steps again once the gesture has gone quiet", () => {
    const first = feed([50]);
    expect(first.gesture).toEqual({ travelled: 0, latched: true });
    // The pager resets to WHEEL_QUIET after the idle gap.
    expect(wheelStep(WHEEL_QUIET, 50, 1, false).direction).toBe(1);
  });

  it("ignores events while a slide is in flight, and does not bank them", () => {
    const gesture: WheelGesture = { travelled: 10, latched: false };
    expect(wheelStep(gesture, 100, 1, true)).toEqual({ gesture, direction: 0 });
  });
});
