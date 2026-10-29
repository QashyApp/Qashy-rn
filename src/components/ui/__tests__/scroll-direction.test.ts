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

  it("does not flip on a jittery scroll whose runs stay short of the threshold", () => {
    // Runs of 16 dp with a 2 dp wobble back: close to the threshold, never at it.
    const deltas = [8, 8, -2, 8, 8, -2, 8, 8, -2, -8, -8, 2, -8, -8, 2];
    let travel = 0;
    for (const delta of deltas) {
      travel = accumulateTravel(travel, delta);
      expect(travelDirection(travel)).toBe(0);
    }
  });

  it("flips as soon as a run in the jitter reaches the threshold", () => {
    // A wobble restarts the run, so only the clean run after it counts.
    const wobble = [8, 8, -2, 10];
    expect(travelDirection(run(wobble))).toBe(0);
    expect(travelDirection(run([...wobble, 9]))).toBe(0);
    expect(travelDirection(run([...wobble, 10]))).toBe(1);
    expect(travelDirection(run([-8, -8, 2, -10, -10]))).toBe(-1);
  });

  it("does not flip back on a twitch after a long run", () => {
    expect(travelDirection(run([40, -3]))).toBe(0);
    expect(travelDirection(run([40, -3, -3, -3, -3, -3, -3]))).toBe(0);
    expect(travelDirection(run([40, -3, -3, -3, -3, -3, -3, -3]))).toBe(-1);
  });

  it("flips on a slow but sustained scroll up", () => {
    expect(travelDirection(run([30, -3, -3, -3, -3, -3, -3, -3]))).toBe(-1);
  });
});
