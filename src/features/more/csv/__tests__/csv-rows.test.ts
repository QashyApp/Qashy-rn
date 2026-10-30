import { inferMapping } from "@/features/more/csv/csv-model";
import {
  amountSignDecidesType,
  buildCsvRows,
  csvDateRejectionReason,
  type CsvSourceRecord,
} from "@/features/more/csv/csv-rows";

const defaults = { accountName: "Everyday", baseCurrency: "usd" };
const record = (
  rowNumber: number,
  fields: Record<string, string>,
): CsvSourceRecord => ({ rowNumber, ...fields });

describe("buildCsvRows signs", () => {
  const records = [
    record(2, { date: "2026-07-01", title: "Coffee", amount: "-4.50" }),
    record(3, { date: "2026-07-02", title: "Pay", amount: "1000.00" }),
    record(4, { date: "2026-07-03", title: "Lunch", amount: "(12.00)" }),
  ];
  const mapping = inferMapping(["date", "title", "amount"]);

  it("derives the type from the sign when no type column is mapped", () => {
    expect(amountSignDecidesType(records, mapping)).toBe(true);
    const { rows } = buildCsvRows(records, mapping, "ymd", defaults);
    expect(rows.map((row) => [row.type, row.amount])).toEqual([
      ["expense", "4.50"],
      ["income", "1000.00"],
      ["expense", "12.00"],
    ]);
  });

  it("keeps the expense default when no amount is negative", () => {
    const positive = records.filter((item) => item.rowNumber === 3);
    expect(amountSignDecidesType(positive, mapping)).toBe(false);
    const { rows } = buildCsvRows(positive, mapping, "ymd", defaults);
    expect(rows[0]).toMatchObject({ type: "expense", amount: "1000.00" });
  });

  it("uses the mapped type with the absolute amount when a type column exists", () => {
    const typed = inferMapping(["date", "title", "amount", "type"]);
    const withType = [
      record(2, {
        date: "2026-07-01",
        title: "Refund",
        amount: "-4.50",
        type: "income",
      }),
      record(3, {
        date: "2026-07-02",
        title: "Pay",
        amount: "9.00",
        type: "Expense",
      }),
    ];
    expect(amountSignDecidesType(withType, typed)).toBe(false);
    const { rows } = buildCsvRows(withType, typed, "ymd", defaults);
    expect(rows.map((row) => [row.type, row.amount])).toEqual([
      ["income", "4.50"],
      ["expense", "9.00"],
    ]);
  });

  it("leaves a signed transfer amount untouched so it is still refused", () => {
    const typed = inferMapping(["date", "title", "amount", "type"]);
    const { rows } = buildCsvRows(
      [
        record(2, {
          date: "2026-07-01",
          title: "Move",
          amount: "-5.00",
          type: "transfer",
        }),
      ],
      typed,
      "ymd",
      defaults,
    );
    expect(rows[0].amount).toBe("-5.00");
  });

  it("falls back to the default account and upper-cased base currency", () => {
    const { rows } = buildCsvRows(records, mapping, "ymd", defaults);
    expect(rows[0]).toMatchObject({ account: "Everyday", currency: "USD" });
  });
});

describe("buildCsvRows dates", () => {
  const mapping = inferMapping(["date", "title", "amount"]);
  const records = [
    record(2, { date: "25/07/2026", title: "A", amount: "1" }),
    record(3, { date: "02/03/2026", title: "B", amount: "1" }),
    record(4, { date: "31/02/2026", title: "C", amount: "1" }),
  ];

  it("normalizes each row to ISO and reports unreadable dates by format", () => {
    const { rows, dateRejections } = buildCsvRows(
      records,
      mapping,
      "dmy",
      defaults,
    );
    expect(rows.map((row) => row.date)).toEqual(["2026-07-25", "2026-03-02"]);
    expect(dateRejections).toEqual([
      { rowNumber: 4, reason: csvDateRejectionReason("dmy") },
    ]);
    expect(dateRejections[0].reason).toBe(
      "Enter a real calendar date in the DD/MM/YYYY format.",
    );
  });

  it("reads the same text differently under month-first", () => {
    const { rows, dateRejections } = buildCsvRows(
      records,
      mapping,
      "mdy",
      defaults,
    );
    expect(rows.map((row) => row.date)).toEqual(["2026-02-03"]);
    expect(dateRejections.map((item) => item.rowNumber)).toEqual([2, 4]);
  });
});
