import { addRecurrence } from "@/utils/date";
import {
  nthOccurrenceDate,
  occurrenceCountUntil,
} from "@/utils/recurrence-count";

/** The dates generation itself would produce, one step at a time. */
function stepped(
  start: string,
  unit: "day" | "week" | "month" | "year",
  interval: number,
  count: number,
) {
  const dates = [start];
  while (dates.length < count)
    dates.push(addRecurrence(dates.at(-1)!, unit, interval, start));
  return dates;
}

describe("nthOccurrenceDate", () => {
  it("is the start date for the first occurrence", () => {
    expect(nthOccurrenceDate("2026-03-15", "month", 1, 1)).toBe("2026-03-15");
  });

  it.each([
    ["2026-01-31", "month", 1, 12],
    ["2026-01-30", "month", 2, 7],
    ["2024-02-29", "year", 1, 5],
    ["2026-10-05", "week", 2, 10],
    ["2026-12-30", "day", 3, 40],
  ] as const)(
    "matches step-by-step generation for %s every %s × %i",
    (start, unit, interval, count) => {
      expect(nthOccurrenceDate(start, unit, interval, count)).toBe(
        stepped(start, unit, interval, count).at(-1),
      );
    },
  );

  it("rejects a count below one", () => {
    expect(() => nthOccurrenceDate("2026-01-01", "month", 1, 0)).toThrow();
  });
});

describe("occurrenceCountUntil", () => {
  it("counts the occurrences up to and including the end date", () => {
    expect(occurrenceCountUntil("2026-01-31", "month", 1, "2026-12-31")).toBe(
      12,
    );
    expect(occurrenceCountUntil("2026-01-31", "month", 1, "2026-12-30")).toBe(
      11,
    );
  });

  it("round-trips with nthOccurrenceDate", () => {
    const end = nthOccurrenceDate("2026-10-05", "week", 1, 8);
    expect(occurrenceCountUntil("2026-10-05", "week", 1, end)).toBe(8);
  });

  it("returns null for an end before the start or an invalid date", () => {
    expect(occurrenceCountUntil("2026-05-01", "month", 1, "2026-04-30")).toBe(
      null,
    );
    expect(occurrenceCountUntil("2026-05-01", "month", 1, "nope")).toBe(null);
  });

  it("returns null past the maximum count", () => {
    expect(occurrenceCountUntil("2026-01-01", "day", 1, "2030-01-01")).toBe(
      null,
    );
  });
});
