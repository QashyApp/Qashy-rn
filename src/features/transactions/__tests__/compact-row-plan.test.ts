import {
  MIN_CUT_LABEL,
  planCompactRow,
} from "@/features/transactions/compact-row-plan";

// Three pills: a short figure and two longer ones, with a label of 60px (50 when smaller).
const pill = (amount: number) => ({ label: 60, smallLabel: 50, amount });
const chrome = 30;
const gap = 8;
const needs = [pill(40), pill(60), pill(70)];
// Natural widths with the full labels: (30 + 60 + a) summed, plus two gaps.
const fullTotal = 3 * (chrome + 60) + (40 + 60 + 70) + 2 * gap; // 456
const smallTotal = 3 * (chrome + 50) + (40 + 60 + 70) + 2 * gap; // 426
// Figures and a label cut down to its least.
const minimumTotal = 3 * (chrome + MIN_CUT_LABEL) + (40 + 60 + 70) + 2 * gap; // 372

describe("planCompactRow", () => {
  it("keeps full-size labels while every pill fits at its own size", () => {
    expect(planCompactRow(needs, fullTotal, chrome, gap)).toBe("full");
    expect(planCompactRow(needs, 600, chrome, gap)).toBe("full");
  });

  it("steps the labels down one size before anything else", () => {
    expect(planCompactRow(needs, fullTotal - 1, chrome, gap)).toBe("small");
    expect(planCompactRow(needs, smallTotal, chrome, gap)).toBe("small");
  });

  it("cuts a label short, to a readable least, only once the smaller size does not fit either", () => {
    expect(planCompactRow(needs, smallTotal - 1, chrome, gap)).toBe("cut");
    expect(planCompactRow(needs, minimumTotal, chrome, gap)).toBe("cut");
  });

  it("stacks the pills when the figures alone do not fit side by side", () => {
    expect(planCompactRow(needs, minimumTotal - 1, chrome, gap)).toBe(
      "stacked",
    );
    expect(planCompactRow(needs, 120, chrome, gap)).toBe("stacked");
  });

  it("waits for a measured row and for pills to size", () => {
    expect(planCompactRow(needs, 0, chrome, gap)).toBe("full");
    expect(planCompactRow([], 300, chrome, gap)).toBe("full");
  });
});
