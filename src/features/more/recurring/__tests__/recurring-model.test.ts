import {
  intervalHint,
  projectedNextDueDate,
  recurrenceLabel,
  scheduleHasEnded,
} from "@/features/more/recurring/recurring-model";

const today = "2026-06-15";

describe("recurrenceLabel", () => {
  it("words one repeat and many alike for the form and the list", () => {
    expect(recurrenceLabel(1, "month")).toBe("Every month.");
    expect(recurrenceLabel(2, "week")).toBe("Every 2 weeks.");
    expect(intervalHint("3", "day")).toBe("Every 3 days.");
    expect(intervalHint("", "year")).toBe("Every year.");
  });
});

describe("scheduleHasEnded", () => {
  const base = {
    unit: "month" as const,
    interval: 1,
    startDate: "2026-01-10",
    endDate: null as string | null,
    today,
  };

  it("never ends without an end date", () => {
    expect(scheduleHasEnded({ ...base })).toBe(false);
  });

  it("has ended when the first occurrence from today falls past the end date", () => {
    // A new monthly rule from Jan 10 starts at its first date on or after today: Jul 10.
    expect(projectedNextDueDate({ ...base })).toBe("2026-07-10");
    expect(scheduleHasEnded({ ...base, endDate: "2026-06-30" })).toBe(true);
    expect(scheduleHasEnded({ ...base, endDate: "2026-07-10" })).toBe(false);
  });

  it("keeps an unchanged schedule's own next due date", () => {
    const existing = {
      unit: "month" as const,
      interval: 1,
      startDate: "2026-01-10",
      endDate: "2026-12-10",
      nextDueDate: "2026-07-10",
    };
    expect(scheduleHasEnded({ ...base, existing, endDate: "2026-12-10" })).toBe(
      false,
    );
    // Pulling the end date before the next due date ends it.
    expect(scheduleHasEnded({ ...base, existing, endDate: "2026-07-01" })).toBe(
      true,
    );
  });

  it("restarts a changed schedule from its earliest pending occurrence", () => {
    const existing = {
      unit: "month" as const,
      interval: 1,
      startDate: "2026-01-10",
      endDate: null,
      nextDueDate: "2026-07-10",
    };
    // Overdue pending item on Jun 10: regeneration restarts there, so the rule is not ended yet.
    expect(
      scheduleHasEnded({
        ...base,
        existing,
        endDate: "2026-06-30",
        earliestPendingDate: "2026-06-10",
      }),
    ).toBe(false);
  });
});
