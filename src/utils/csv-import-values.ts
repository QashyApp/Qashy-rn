import { isLocalDate } from "@/utils/date";

/**
 * Pure helpers that turn the loosely formatted dates and amounts of a bank export into the strict
 * forms the repository accepts (an ISO `YYYY-MM-DD` date, an unsigned decimal amount).
 */

export type CsvDateFormat = "ymd" | "dmy" | "mdy";
export type CsvDateChoice = "auto" | CsvDateFormat;

export const CSV_DATE_FORMAT_LABELS: Record<CsvDateFormat, string> = {
  ymd: "YYYY-MM-DD",
  dmy: "DD/MM/YYYY",
  mdy: "MM/DD/YYYY",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Day and month may be written with one digit; `/`, `.` and `-` separate the parts. Two-digit
// years are not accepted: "03/04/05" has no unambiguous reading, so the year must have four digits.
const PART_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function pad(value: number, width: number) {
  return String(value).padStart(width, "0");
}

/**
 * Reads one date in the given format into `YYYY-MM-DD`, or null when it is not a real calendar
 * date in that format. An ISO date is read as such under every choice: a four-digit lead is never
 * ambiguous with day or month.
 */
export function normalizeCsvDate(
  value: string,
  format: CsvDateFormat,
): string | null {
  const text = value.trim();
  if (ISO_DATE.test(text)) return isLocalDate(text) ? text : null;
  if (format === "ymd") return null;
  const match = PART_DATE.exec(text);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const day = format === "dmy" ? first : second;
  const month = format === "dmy" ? second : first;
  const iso = `${pad(Number(match[3]), 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  return isLocalDate(iso) ? iso : null;
}

/** Whether the locale writes the month before the day (en-US), falling back to day-first. */
export function localePrefersMonthFirst(locale: string | undefined) {
  if (!locale) return false;
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(new Date(2001, 1, 3));
    const order = parts.map((part) => part.type);
    return order.indexOf("month") < order.indexOf("day");
  } catch {
    return false;
  }
}

/**
 * The format `Auto` resolves to for a column of dates.
 *  1. Every non-empty value is ISO (or nothing is day/month/year shaped): `ymd`.
 *  2. Some value has a first part above 12: day-first. Some has a second part above 12:
 *     month-first. Each is conclusive.
 *  3. Still ambiguous (or contradictory, in which case the rows that do not fit are rejected with
 *     a message naming the format): the device locale's order, which is day-first for Hebrew and
 *     most locales and month-first for en-US. The user can override the choice in the picker.
 */
export function detectCsvDateFormat(
  values: readonly string[],
  locale?: string,
): CsvDateFormat {
  let dayFirst = false;
  let monthFirst = false;
  let sawParts = false;
  for (const raw of values) {
    const match = PART_DATE.exec(raw.trim());
    if (!match) continue;
    sawParts = true;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (!sawParts) return "ymd";
  if (dayFirst && !monthFirst) return "dmy";
  if (monthFirst && !dayFirst) return "mdy";
  return localePrefersMonthFirst(locale) ? "mdy" : "dmy";
}

/** Resolves the picker choice to a concrete format for the column's values. */
export function resolveCsvDateFormat(
  choice: CsvDateChoice,
  values: readonly string[],
  locale?: string,
): CsvDateFormat {
  return choice === "auto" ? detectCsvDateFormat(values, locale) : choice;
}

const MINUS = "[-\\u2212\\u2012-\\u2015]";
const LEADING_MINUS = new RegExp(`^${MINUS}\\s*`);
const TRAILING_MINUS = new RegExp(`\\s*${MINUS}$`);

/**
 * Splits a bank-style signed amount into its sign and unsigned text: `-12.50`, `(12.50)` and
 * `12.50-` are negative. Anything else is returned untouched (trimmed), so a value that was
 * invalid before stays invalid and is reported by the amount parser.
 */
export function splitCsvAmountSign(raw: string): {
  negative: boolean;
  amount: string;
} {
  const text = raw.trim();
  let body = text;
  let negative = false;
  const wrapped = /^\(\s*(.*?)\s*\)$/.exec(body);
  if (wrapped) {
    body = wrapped[1];
    negative = true;
  } else if (LEADING_MINUS.test(body)) {
    body = body.replace(LEADING_MINUS, "");
    negative = true;
  } else if (TRAILING_MINUS.test(body)) {
    body = body.replace(TRAILING_MINUS, "");
    negative = true;
  }
  // "-", "()" or "-(5)" are not amounts: leave them for the amount parser to refuse.
  if (!negative || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(body)) {
    return { negative: false, amount: text };
  }
  return { negative: true, amount: body };
}
