import type { RecurrenceUnit, RecurringRule } from "@/domain/models";
import { firstRecurrenceOnOrAfter } from "@/utils/date";
import { nextDueDateOnReactivation } from "@/utils/recurring-impact";

export const MAX_REPEAT_INTERVAL = 999;

/**
 * "Every month." / "Every 2 months." — plain English singular/plural; Hermes (Android) has no
 * `Intl.PluralRules`. The one wording for how often a schedule repeats, shared by the form hint
 * and the schedule list so both read the same.
 */
export function recurrenceLabel(interval: number, unit: RecurrenceUnit) {
  if (!Number.isInteger(interval) || interval < 1) return `Every ${unit}.`;
  return interval === 1 ? `Every ${unit}.` : `Every ${interval} ${unit}s.`;
}

/** The same label for the form's interval text field, which holds a string. */
export function intervalHint(interval: string, unit: RecurrenceUnit) {
  return recurrenceLabel(Number(interval), unit);
}

export type EndMode = "never" | "date" | "count";

export const END_MODES: { value: EndMode; label: string; icon: string }[] = [
  { value: "never", label: "Never", icon: "ion:infinite-outline" },
  { value: "date", label: "On a date", icon: "calendar" },
  { value: "count", label: "After a number of times", icon: "repeat" },
];

/**
 * The next due date saving a schedule would give it, mirroring `planRecurringRuleSave`: an
 * unchanged schedule keeps its date; a new or changed one restarts at its first occurrence on or
 * after where regeneration begins (the earliest pending occurrence, else today at the earliest;
 * moving the start earlier backfills from the new start). `active` is the switch as it would be
 * saved. Switching a paused schedule on skips the dates it was paused through: it resumes at its
 * first occurrence on or after today, with no backfill, even when the same save changes the
 * schedule. One that is saved switched off gets no today floor, so editing a paused schedule
 * never moves its date past the end date.
 */
export function projectedNextDueDate({
  existing,
  active,
  unit,
  interval,
  startDate,
  endDate,
  earliestPendingDate,
  today,
}: {
  existing?: Pick<
    RecurringRule,
    "unit" | "interval" | "startDate" | "endDate" | "nextDueDate"
  > & { active?: boolean };
  active: boolean;
  unit: RecurrenceUnit;
  interval: number;
  startDate: string;
  endDate: string | null;
  earliestPendingDate?: string;
  today: string;
}) {
  const later = (a: string, b: string) => (a > b ? a : b);
  const resuming = !!existing && existing.active === false && active;
  const staysPaused = !!existing && !active;
  if (
    existing &&
    existing.unit === unit &&
    existing.interval === interval &&
    existing.startDate === startDate &&
    existing.endDate === endDate
  )
    return resuming
      ? nextDueDateOnReactivation(existing, today)
      : existing.nextDueDate;
  const base = resuming
    ? later(earliestPendingDate ?? existing.nextDueDate, today)
    : staysPaused
      ? (earliestPendingDate ?? existing.nextDueDate)
      : (earliestPendingDate ??
        later(existing ? existing.nextDueDate : startDate, today));
  const from =
    existing && !resuming && startDate < existing.startDate && startDate < base
      ? startDate
      : base;
  return firstRecurrenceOnOrAfter(
    startDate,
    unit,
    interval,
    later(startDate, from),
  );
}
