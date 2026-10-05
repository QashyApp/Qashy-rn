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
