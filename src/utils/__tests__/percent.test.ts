import { percentShares } from "@/utils/percent";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("percentShares", () => {
  it("gives three equal thirds 34, 33 and 33", () => {
    expect(percentShares([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("sums to 100 where independent rounding gives 101", () => {
    // 12.5 / 37.5 / 25 / 25 rounds to 13 + 38 + 25 + 25 = 101 on its own.
    const shares = percentShares([1, 3, 2, 2]);
    expect(Math.round((1 / 8) * 100) + Math.round((3 / 8) * 100) + 50).toBe(
      101,
    );
    expect(sum(shares)).toBe(100);
    expect(shares).toEqual([13, 37, 25, 25]);
  });

  it("sums to 100 where independent rounding gives 99", () => {
    const shares = percentShares([1, 1, 1, 1, 1, 1, 1]);
    expect(Math.round(100 / 7) * 7).toBe(98);
    expect(sum(shares)).toBe(100);
  });

  it("keeps a single slice at 100", () => {
    expect(percentShares([4_200])).toEqual([100]);
  });

  it("returns exact shares unchanged", () => {
    expect(percentShares([50, 30, 20])).toEqual([50, 30, 20]);
  });

  it("is zero for an empty or all-zero list", () => {
    expect(percentShares([])).toEqual([]);
    expect(percentShares([0, 0])).toEqual([0, 0]);
  });

  it("never gives a point to a zero amount", () => {
    const shares = percentShares([1, 0, 2]);
    expect(shares[1]).toBe(0);
    expect(sum(shares)).toBe(100);
  });

  it("sums to 100 for many random splits", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    for (let run = 0; run < 200; run += 1) {
      const amounts = Array.from(
        { length: 1 + (next() % 9) },
        () => 1 + (next() % 10_000),
      );
      expect(sum(percentShares(amounts))).toBe(100);
    }
  });
});
