import type { CsvImportRow } from "@/domain/models";

export type CsvField = Exclude<keyof CsvImportRow, "rowNumber">;

export const CSV_FIELDS: {
  key: CsvField;
  label: string;
  optional?: boolean;
  aliases: string[];
}[] = [
  {
    key: "date",
    label: "Date",
    aliases: ["date", "transaction_date", "posted_date"],
  },
  {
    key: "type",
    label: "Type",
    optional: true,
    aliases: ["type", "kind", "transaction_type"],
  },
  {
    key: "status",
    label: "Status",
    optional: true,
    aliases: ["status", "transaction_status"],
  },
  {
    key: "title",
    label: "Title",
    aliases: ["title", "description", "merchant", "name"],
  },
  { key: "amount", label: "Amount", aliases: ["amount", "value"] },
  {
    key: "currency",
    label: "Currency",
    optional: true,
    aliases: ["currency", "currency_code"],
  },
  { key: "account", label: "Account", aliases: ["account", "account_name"] },
  {
    key: "category",
    label: "Category",
    optional: true,
    aliases: ["category", "category_name"],
  },
  { key: "tags", label: "Tags", optional: true, aliases: ["tags", "labels"] },
  {
    key: "note",
    label: "Notes",
    optional: true,
    aliases: ["note", "notes", "memo"],
  },
  {
    key: "exchangeRate",
    label: "Exchange rate",
    optional: true,
    aliases: ["exchange_rate", "exchangerate"],
  },
  {
    key: "destinationAccount",
    label: "Destination account",
    optional: true,
    aliases: ["destination_account", "to_account"],
  },
  {
    key: "destinationAmount",
    label: "Destination amount",
    optional: true,
    aliases: ["destination_amount", "to_amount"],
  },
  {
    key: "destinationBaseAmountMinor",
    label: "Destination base amount (minor units)",
    optional: true,
    aliases: ["destination_base_amount_minor", "destinationbaseamountminor"],
  },
  {
    key: "foreignAmount",
    label: "Foreign amount",
    optional: true,
    aliases: ["foreign_amount", "foreignamount"],
  },
  {
    key: "foreignCurrency",
    label: "Foreign currency",
    optional: true,
    aliases: ["foreign_currency", "foreigncurrency"],
  },
  {
    key: "foreignExchangeRate",
    label: "Foreign exchange rate",
    optional: true,
    aliases: ["foreign_exchange_rate", "foreignexchangerate", "foreign_rate"],
  },
  {
    key: "feeKind",
    label: "Fee kind (percent or fixed)",
    optional: true,
    aliases: ["fee_kind", "feekind", "fee_type"],
  },
  {
    key: "feeValue",
    label: "Fee value",
    optional: true,
    aliases: ["fee_value", "feevalue"],
  },
];

/**
 * The picker's MIME filter cannot be trusted for CSV: Android reports a `.csv` as
 * `application/vnd.ms-excel` or `application/octet-stream`. So the file is picked unfiltered and
 * its extension is checked instead. `.txt` stays accepted because it always was.
 */
export const CSV_EXTENSIONS = ["csv", "txt"];

export function inferMapping(headers: string[]) {
  return Object.fromEntries(
    CSV_FIELDS.map((field) => [
      field.key,
      field.aliases.find((alias) => headers.includes(alias)) ?? "",
    ]),
  ) as Record<CsvField, string>;
}
