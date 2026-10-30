import { dateFormat, parseLocalDate } from "@/utils/date";

/** How a picked `YYYY-MM-DD` reads in a date field: weekday, day, month and year. */
export function formatFieldDate(value: string, locale: string) {
  return dateFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parseLocalDate(value));
}

export interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD`, or `""` when an optional date is not set. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Shows a clear button once a date is set, so the date can go back to "not set". */
  optional?: boolean;
  /** Earliest and latest choosable dates, as `YYYY-MM-DD`. */
  minimumDate?: string;
  maximumDate?: string;
}

/**
 * Why `value` cannot be used given the field's bounds, as a sentence naming the allowed range,
 * or `null` when it is inside them (or there is nothing to check). Bounds and value are
 * `YYYY-MM-DD`, which compares correctly as text. The picker already keeps its own choices
 * inside the bounds; this is for a date typed into the browser's input, which does not.
 */
export function dateRangeHint(
  value: string,
  locale: string,
  minimumDate?: string,
  maximumDate?: string,
): string | null {
  if (!value) return null;
  const tooEarly = Boolean(minimumDate) && value < minimumDate!;
  const tooLate = Boolean(maximumDate) && value > maximumDate!;
  if (!tooEarly && !tooLate) return null;
  if (minimumDate && maximumDate) {
    return `Choose a date between ${formatFieldDate(minimumDate, locale)} and ${formatFieldDate(maximumDate, locale)}`;
  }
  return minimumDate
    ? `Choose a date on or after ${formatFieldDate(minimumDate, locale)}`
    : `Choose a date on or before ${formatFieldDate(maximumDate!, locale)}`;
}
