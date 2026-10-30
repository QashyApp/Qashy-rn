import { cumulativeSpend } from "@/features/overview/cumulative-spend";

const days = (amounts: number[], first = 1) =>
  amounts.map((amountMinor, index) => ({
    date: `2026-07-${String(first + index).padStart(2, "0")}`,
    amountMinor,
  }));

describe("cumulativeSpend", () => {
  it("keeps every day of a past month", () => {
    expect(cumulativeSpend(days([100, 0, 50]), "2026-08-15")).toEqual([
      100, 100, 150,
    ]);
  });

  it("stops at today in the current month", () => {
    expect(cumulativeSpend(days([100, 0, 50, 70]), "2026-07-03")).toEqual([
      100, 100, 150,
    ]);
  });

  it("includes today itself", () => {
    expect(cumulativeSpend(days([100, 25]), "2026-07-02")).toEqual([100, 125]);
  });

  it("is empty for a month that has not started", () => {
    expect(cumulativeSpend(days([0, 0, 0]), "2026-06-30")).toEqual([]);
  });

  it("carries a refund as a falling total", () => {
    expect(cumulativeSpend(days([100, -40]), "2026-07-31")).toEqual([100, 60]);
  });
});
