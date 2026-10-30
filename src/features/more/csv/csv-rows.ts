import type {
  CsvImportRow,
  TransactionKind,
  TransactionStatus,
} from "@/domain/models";
import type { CsvField } from "@/features/more/csv/csv-model";
import { csvCategoryForRow } from "@/utils/csv";
import {
  CSV_DATE_FORMAT_LABELS,
  type CsvDateFormat,
  normalizeCsvDate,
  splitCsvAmountSign,
} from "@/utils/csv-import-values";

export type CsvSourceRecord = Record<string, string | number>;

export interface CsvRowDefaults {
  accountName: string;
  baseCurrency: string;
  category?: { name: string; kind: "expense" | "income" };
}

/** A row whose date could not be read in the chosen format; it never reaches the repository. */
export interface CsvDateRejection {
  rowNumber: number;
  reason: string;
}

/** The reason shown for a date that is not a real calendar date in the chosen format. */
export function csvDateRejectionReason(format: CsvDateFormat) {
  return `Enter a real calendar date in the ${CSV_DATE_FORMAT_LABELS[format]} format.`;
}

/**
 * Whether the file's amounts decide each row's type: no type column is mapped and at least one
 * amount carries a minus sign. A file with no negative amounts keeps the old default (expense).
 */
export function amountSignDecidesType(
  records: readonly CsvSourceRecord[],
  mapping: Record<CsvField, string>,
) {
  if (mapping.type || !mapping.amount) return false;
  return records.some(
    (record) =>
      splitCsvAmountSign(String(record[mapping.amount] ?? "")).negative,
  );
}

/**
 * Maps source records to import rows. Dates are normalized to ISO and amounts to their absolute
 * value:
 *  - with a type column, the mapped type is used;
 *  - with none, the sign decides when the file has negative amounts (negative expense, positive
 *    income), otherwise every row is an expense.
 * Transfers keep their amount text untouched, so a signed transfer is still refused downstream.
 * Rows with an unreadable date are returned separately as rejections.
 */
export function buildCsvRows(
  records: readonly CsvSourceRecord[],
  mapping: Record<CsvField, string>,
  dateFormat: CsvDateFormat,
  defaults: CsvRowDefaults,
): { rows: CsvImportRow[]; dateRejections: CsvDateRejection[] } {
  const value = (record: CsvSourceRecord, field: CsvField) =>
    mapping[field] ? String(record[mapping[field]] ?? "") : "";
  const signDecidesType = amountSignDecidesType(records, mapping);
  const rows: CsvImportRow[] = [];
  const dateRejections: CsvDateRejection[] = [];
  for (const record of records) {
    const rowNumber = Number(record.rowNumber);
    const date = normalizeCsvDate(value(record, "date"), dateFormat);
    if (date === null) {
      dateRejections.push({
        rowNumber,
        reason: csvDateRejectionReason(dateFormat),
      });
      continue;
    }
    const signed = splitCsvAmountSign(value(record, "amount"));
    const mappedType = value(record, "type");
    const type = (
      mappedType || (signDecidesType && !signed.negative ? "income" : "expense")
    ).toLowerCase() as TransactionKind;
    rows.push({
      rowNumber,
      date,
      type,
      status: (
        value(record, "status") || "posted"
      ).toLowerCase() as TransactionStatus,
      title: value(record, "title"),
      amount: type === "transfer" ? value(record, "amount") : signed.amount,
      currency: (
        value(record, "currency") || defaults.baseCurrency
      ).toUpperCase(),
      account: value(record, "account") || defaults.accountName,
      category: csvCategoryForRow(
        value(record, "category"),
        type,
        defaults.category,
      ),
      tags: value(record, "tags"),
      note: value(record, "note"),
      exchangeRate: value(record, "exchangeRate"),
      destinationAccount: value(record, "destinationAccount"),
      destinationAmount: value(record, "destinationAmount"),
      destinationBaseAmountMinor: value(record, "destinationBaseAmountMinor"),
      foreignAmount: value(record, "foreignAmount"),
      foreignCurrency: value(record, "foreignCurrency"),
      foreignExchangeRate: value(record, "foreignExchangeRate"),
      feeKind: value(record, "feeKind"),
      feeValue: value(record, "feeValue"),
    });
  }
  return { rows, dateRejections };
}
