import { budgetPace } from "@/utils/pace";

describe("budgetPace", () => {
  test("period not started: elapsed and spend both read zero", () => {
    const result = budgetPace({
      spentMinor: 0,
      limitMinor: 10_000,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-01-15",
    });
    expect(result.elapsedRatio).toBe(0);
    expect(result.spentRatio).toBe(0);
    expect(result.projectedMinor).toBe(0);
    expect(result.status).toBe("onTrack");
  });

  test("last day of the period: elapsed ratio reaches 1", () => {
    const result = budgetPace({
      spentMinor: 9_000,
      limitMinor: 10_000,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-02-28",
    });
    expect(result.elapsedRatio).toBe(1);
    expect(result.spentRatio).toBeCloseTo(0.9);
    // At elapsedRatio 1, the projection equals the amount actually spent.
    expect(result.projectedMinor).toBe(9_000);
    // 90% spent with 100% of the period elapsed is comfortably under pace.
    expect(result.status).toBe("under");
  });

  test("zero limit with any spend is over, with none is on track", () => {
    const spending = budgetPace({
      spentMinor: 500,
      limitMinor: 0,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-02-10",
    });
    expect(spending.spentRatio).toBe(1);
    expect(spending.status).toBe("over");

    const noSpend = budgetPace({
      spentMinor: 0,
      limitMinor: 0,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-02-10",
    });
    expect(noSpend.spentRatio).toBe(0);
    expect(noSpend.status).toBe("onTrack");
  });

  test("already over the limit reports over regardless of pace", () => {
    const result = budgetPace({
      spentMinor: 12_000,
      limitMinor: 10_000,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-02-05",
    });
    expect(result.spentRatio).toBeGreaterThan(1);
    expect(result.status).toBe("over");
  });

  test("zero spend partway through the period reads under pace", () => {
    // Feb 1 to Feb 28 is 28 days; Feb 15 is day 15, elapsedRatio ~0.5.
    const result = budgetPace({
      spentMinor: 0,
      limitMinor: 10_000,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-02-15",
    });
    expect(result.elapsedRatio).toBeCloseTo(15 / 28, 2);
    expect(result.spentRatio).toBe(0);
    expect(result.projectedMinor).toBe(0);
    expect(result.status).toBe("under");
  });

  test("spending far ahead of elapsed time projects over the limit", () => {
    // One week (7 days) in on a 28-day period, already at 40% of the limit.
    const result = budgetPace({
      spentMinor: 4_000,
      limitMinor: 10_000,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-02-07",
    });
    expect(result.elapsedRatio).toBeCloseTo(7 / 28, 2);
    expect(result.projectedMinor).toBeGreaterThan(10_000);
    expect(result.status).toBe("projectedOver");
  });

  test("spending in step with elapsed time reads on track", () => {
    // Day 14 of 28 (exactly half elapsed), exactly half spent.
    const result = budgetPace({
      spentMinor: 5_000,
      limitMinor: 10_000,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      today: "2026-02-14",
    });
    expect(result.elapsedRatio).toBeCloseTo(0.5, 2);
    expect(result.spentRatio).toBe(0.5);
    expect(result.projectedMinor).toBe(10_000);
    expect(result.status).toBe("onTrack");
  });

  test("a single-day custom period is a complete period on its own day", () => {
    const result = budgetPace({
      spentMinor: 500,
      limitMinor: 1_000,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-01",
      today: "2026-02-01",
    });
    expect(result.elapsedRatio).toBe(1);
    expect(result.projectedMinor).toBe(500);
    // Half the limit spent on a fully elapsed period is under pace.
    expect(result.status).toBe("under");
  });
});
