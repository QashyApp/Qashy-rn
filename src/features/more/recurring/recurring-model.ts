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

/** A paused schedule's next due date as it would stand once switched on; an active one's own. */
function resumedNextDueDate(
  rule: Parameters<typeof nextDueDateOnReactivation>[0] & {
    active?: boolean;
  },
  today: string,
) {
  return rule.active === false
    ? nextDueDateOnReactivation(rule, today)
    : rule.nextDueDate;
}

/**
 * The next due date saving a schedule would give it, mirroring `planRecurringRuleSave`: an
 * unchanged schedule keeps its date; a new or changed one restarts at its first occurrence on or
 * after where regeneration begins (the earliest pending occurrence, else today at the earliest;
 * moving the start earlier backfills from the new start). A paused schedule is projected as if it
 * were switched back on, which skips the dates it was paused through.
 */
export function projectedNextDueDate({
  existing,
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
  unit: RecurrenceUnit;
  interval: number;
  startDate: string;
  endDate: string | null;
  earliestPendingDate?: string;
  today: string;
}) {
  const later = (a: string, b: string) => (a > b ? a : b);
  if (
    existing &&
    existing.unit === unit &&
    existing.interval === interval &&
    existing.startDate === startDate &&
    existing.endDate === endDate
  )
    return resumedNextDueDate(existing, today);
  const base =
    earliestPendingDate ??
    later(existing ? resumedNextDueDate(existing, today) : startDate, today);
  const from =
    existing && startDate < existing.startDate && startDate < base
      ? startDate
      : base;
  return firstRecurrenceOnOrAfter(
    startDate,
    unit,
    interval,
    later(startDate, from),
  );
}

/**
 * Whether the schedule, as the form describes it, has no occurrence left: its next due date is
 * already past its end date. Saving it switches the schedule off, so the form says so instead.
 */
export function scheduleHasEnded(
  input: Parameters<typeof projectedNextDueDate>[0],
) {
  return Boolean(input.endDate && projectedNextDueDate(input) > input.endDate);
}
