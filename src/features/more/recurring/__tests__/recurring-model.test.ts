import {
  intervalHint,
  projectedNextDueDate,
  recurrenceLabel,
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

describe("projectedNextDueDate", () => {
  const base = {
    active: true,
    unit: "month" as const,
    interval: 1,
    startDate: "2026-01-10",
    endDate: null as string | null,
    today,
  };

  it("starts a new schedule at its first date on or after today", () => {
    // A new monthly rule from Jan 10 starts at its first date on or after today: Jul 10.
    expect(projectedNextDueDate({ ...base })).toBe("2026-07-10");
    // Six days ahead, but the next monthly date (Jul 10) is later than that: past the end.
    expect(projectedNextDueDate({ ...base, endDate: "2026-06-21" })).toBe(
      "2026-07-10",
    );
  });

  it("keeps an unchanged schedule's own next due date", () => {
    const existing = {
      unit: "month" as const,
      interval: 1,
      startDate: "2026-01-10",
      endDate: "2026-12-10",
      nextDueDate: "2026-07-10",
    };
    expect(
      projectedNextDueDate({ ...base, existing, endDate: "2026-12-10" }),
    ).toBe("2026-07-10");
  });

  it("restarts a changed schedule from its earliest pending occurrence", () => {
    const existing = {
      unit: "month" as const,
      interval: 1,
      startDate: "2026-01-10",
      endDate: null,
      nextDueDate: "2026-07-10",
    };
    // Overdue pending item on Jun 10: regeneration restarts there, before the end date.
    expect(
      projectedNextDueDate({
        ...base,
        existing,
        endDate: "2026-06-30",
        earliestPendingDate: "2026-06-10",
      }),
    ).toBe("2026-06-10");
  });
});

describe("a paused schedule", () => {
  const paused = {
    unit: "month" as const,
    interval: 1,
    startDate: "2026-01-10",
    endDate: "2026-03-31" as string | null,
    nextDueDate: "2026-03-10",
    active: false,
  };
  const args = {
    existing: paused,
    active: true,
    unit: paused.unit,
    interval: paused.interval,
    startDate: paused.startDate,
    endDate: paused.endDate,
    today,
  };

  it("projects the date it would resume at, skipping the dates it was paused through", () => {
    expect(projectedNextDueDate({ ...args, endDate: null })).toBe("2026-07-10");
  });

  it("lands past the end date for a long-expired paused schedule", () => {
    // Its stored next date (Mar 10) is before the end, but resuming would land after it.
    expect(projectedNextDueDate(args) > "2026-03-31").toBe(true);
    // Still paused before the end date: resumes within it.
    expect(projectedNextDueDate({ ...args, today: "2026-03-01" })).toBe(
      "2026-03-10",
    );
  });

  it("keeps an active schedule's own next due date", () => {
    expect(
      projectedNextDueDate({ ...args, existing: { ...paused, active: true } }),
    ).toBe("2026-03-10");
  });

  it("does not floor a schedule that stays paused at today", () => {
    // Saved switched off, an edit keeps the date within the stored schedule, never past the end.
    const stays = { ...args, active: false };
    expect(projectedNextDueDate(stays)).toBe("2026-03-10");
    expect(projectedNextDueDate({ ...stays, interval: 2 })).toBe("2026-03-10");
    // Pausing an active schedule in the same save as a change is no resume either.
    expect(
      projectedNextDueDate({
        ...stays,
        existing: { ...paused, active: true },
        interval: 2,
      }),
    ).toBe("2026-03-10");
  });

  it("unlocks an ended schedule when its end is extended, and leaves it off", () => {
    // Generation ended it: off, with its next date already past the end.
    const ended = { ...paused, nextDueDate: "2026-04-10" };
    const projected = (endDate: string | null) =>
      projectedNextDueDate({
        ...args,
        existing: ended,
        active: false,
        endDate,
      });
    expect(projected("2026-03-31")! > "2026-03-31").toBe(true);
    // Extended past the next payment: no longer ended, and nothing in the projection switches it on.
    expect(projected("2026-06-30")! <= "2026-06-30").toBe(true);
    expect(projected(null)).toBe("2026-04-10");
  });

  it("does not backfill when resumed with a schedule change", () => {
    // An old pending item (Feb 10) would restart regeneration there for an active schedule.
    const change = {
      ...args,
      endDate: null,
      earliestPendingDate: "2026-02-10",
    };
    expect(projectedNextDueDate(change)).toBe("2026-07-10");
    expect(
      projectedNextDueDate({
        ...change,
        existing: { ...paused, active: true },
      }),
    ).toBe("2026-02-10");
    // Moving the start earlier does not backfill a resumed schedule either.
    expect(projectedNextDueDate({ ...change, startDate: "2025-12-10" })).toBe(
      "2026-07-10",
    );
  });
});
