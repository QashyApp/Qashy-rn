import { addRecurrence, isLocalDate } from "@/utils/date";

type RecurrenceUnit = "day" | "week" | "month" | "year";

/** The most occurrences a "repeat N times" schedule may ask for. */
export const MAX_OCCURRENCE_COUNT = 1000;

/**
 * The date of the `count`-th occurrence (1-based) of a schedule starting on `startDate`.
 *
 * Computed in one jump from the start, anchored to it exactly like generation steps through the
 * schedule, so a schedule that starts on the 31st lands on each month's last day here too.
 */
export function nthOccurrenceDate(
  startDate: string,
  unit: RecurrenceUnit,
  interval: number,
  count: number,
) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError("Occurrence count must be a positive whole number.");
  }
  if (count === 1) return startDate;
  return addRecurrence(startDate, unit, interval * (count - 1), startDate);
}

/**
 * How many occurrences a schedule has from `startDate` up to and including `endDate`, or `null`
 * when the dates are not valid or there are more than `MAX_OCCURRENCE_COUNT` of them.
 */
export function occurrenceCountUntil(
  startDate: string,
  unit: RecurrenceUnit,
  interval: number,
  endDate: string,
) {
  if (!isLocalDate(startDate) || !isLocalDate(endDate) || endDate < startDate)
    return null;
  let count = 0;
  let due = startDate;
  while (due <= endDate) {
    count += 1;
    if (count > MAX_OCCURRENCE_COUNT) return null;
    due = addRecurrence(due, unit, interval, startDate);
  }
  return count;
}
