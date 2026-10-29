import {
  FLIP_DISTANCE,
  accumulateTravel,
  travelDirection,
} from "@/components/ui/scroll-direction";

const run = (deltas: number[]) =>
  deltas.reduce((travel, delta) => accumulateTravel(travel, delta), 0);

describe("accumulateTravel", () => {
  it("adds up deltas in the same direction", () => {
    expect(run([4, 5, 6])).toBe(15);
    expect(run([-4, -5])).toBe(-9);
  });

  it("starts a fresh run when the direction changes", () => {
    expect(run([30, 4, -3])).toBe(-3);
    expect(run([-30, 2])).toBe(2);
  });

  it("ignores a standstill", () => {
    expect(run([10, 0, 0, 5])).toBe(15);
  });
});

describe("travelDirection", () => {
  it("needs a full run before it flips", () => {
    expect(travelDirection(FLIP_DISTANCE - 1)).toBe(0);
    expect(travelDirection(FLIP_DISTANCE)).toBe(1);
    expect(travelDirection(-(FLIP_DISTANCE - 1))).toBe(0);
    expect(travelDirection(-FLIP_DISTANCE)).toBe(-1);
  });

  it("does not flip on a slow, jittery scroll", () => {
    // Down 3 dp a frame with a 1 dp wobble back never reaches 20 dp up.
    expect(travelDirection(run([3, 3, -1, 3, 3, -1, 3]))).toBe(0);
  });

  it("flips on a slow but sustained scroll up", () => {
    expect(travelDirection(run([30, -3, -3, -3, -3, -3, -3, -3]))).toBe(-1);
  });
});
