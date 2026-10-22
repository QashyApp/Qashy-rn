import type { FinanceContext } from "@/data/finance/context";
import { queryTransactions } from "@/data/finance/queries";
import { active } from "@/data/finance/records";
import type { BuildTransaction } from "@/data/finance/transactions";
import { transactionDuplicateKey } from "@/data/finance/transactions";
import {
  parseMinorInteger,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from "@/data/finance/validation";
import type {
  CsvImportRow,
  ForeignAmountInput,
  ImportResult,
  Tag,
  TransactionFeeInput,
  TransactionKind,
  TransactionStatus,
} from "@/domain/models";
import type { TransactionInput } from "@/data/repository";
import { escapeCsv } from "@/utils/csv";
import { isLocalDate } from "@/utils/date";
import { createEntity, makeId } from "@/utils/entity";
import { minorToDecimalString, parseInvariantMoney } from "@/utils/money";
import { normalizeName } from "@/utils/naming";
import {
  feeMinorFor,
  normalizeFeePercent,
  totalWithFee,
} from "@/utils/transaction-amounts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CSV_YIELD_EVERY = 250;
const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A CSV row after validation: every optional column present, currency upper-cased. */
interface ParsedCsvRow {
  rowNumber: number;
  date: string;
  type: TransactionKind;
  status: TransactionStatus;
  title: string;
  amount: string;
  currency: string;
  account: string;
  category: string;
  tags: string;
  note: string;
  exchangeRate: string;
  destinationAccount: string;
  destinationAmount: string;
  destinationBaseAmountMinor: string;
  foreignAmount: string;
  foreignCurrency: string;
  foreignExchangeRate: string;
  feeKind: string;
  feeValue: string;
}

type CsvRowParse =
  { success: true; data: ParsedCsvRow } | { success: false; reason: string };

/**
 * Validates one raw CSV row. Hand-written rather than a schema library: the shape is flat, and a
 * schema library was ~12% of the web bundle for three small validators. Reports the first
 * problem in column order, like the schema it replaced.
 */
function parseCsvRow(raw: unknown): CsvRowParse {
  const fail = (reason: string): CsvRowParse => ({ success: false, reason });
  if (!raw || typeof raw !== "object") return fail("Invalid row");
  const row = raw as Record<string, unknown>;
  const text = (key: string) => {
    const value = row[key];
    return typeof value === "string" ? value : undefined;
  };
  const required = (key: string) => {
    const value = text(key);
    return value !== undefined && value.length > 0 ? value : null;
  };
  // A missing optional column is empty; a present one must still be text.
  const optional = (key: string): string | null =>
    row[key] === undefined
      ? ""
      : typeof row[key] === "string"
        ? (row[key] as string)
        : null;

  if (typeof row.rowNumber !== "number" || Number.isNaN(row.rowNumber))
    return fail("Row number is missing.");
  const date = text("date");
  if (date === undefined || !DATE_PATTERN.test(date) || !isLocalDate(date))
    return fail("Enter a real calendar date.");
  const type = row.type;
  if (!(TRANSACTION_TYPES as readonly unknown[]).includes(type))
    return fail(`Type must be one of: ${TRANSACTION_TYPES.join(", ")}.`);
  const status = row.status === undefined ? "posted" : row.status;
  if (!(TRANSACTION_STATUSES as readonly unknown[]).includes(status))
    return fail(`Status must be one of: ${TRANSACTION_STATUSES.join(", ")}.`);
  const title = required("title");
  if (title === null) return fail("Title is required.");
  const amount = required("amount");
  if (amount === null) return fail("Amount is required.");
  const currency = text("currency");
  if (currency === undefined || !/^[A-Za-z]{3}$/.test(currency))
    return fail("Currency must be a three-letter code.");
  const account = required("account");
  if (account === null) return fail("Account is required.");
  const category = optional("category");
  const tags = optional("tags");
  const note = optional("note");
  const exchangeRate = optional("exchangeRate");
  const destinationAccount = optional("destinationAccount");
  const destinationAmount = optional("destinationAmount");
  const destinationBaseAmountMinor = optional("destinationBaseAmountMinor");
  const foreignAmount = optional("foreignAmount");
  const foreignCurrency = optional("foreignCurrency");
  const foreignExchangeRate = optional("foreignExchangeRate");
  const feeKind = optional("feeKind");
  const feeValue = optional("feeValue");
  if (
    category === null ||
    tags === null ||
    note === null ||
    exchangeRate === null ||
    destinationAccount === null ||
    destinationAmount === null ||
    destinationBaseAmountMinor === null ||
    foreignAmount === null ||
    foreignCurrency === null ||
    foreignExchangeRate === null ||
    feeKind === null ||
    feeValue === null
  )
    return fail("Invalid row");
  if (foreignCurrency && !/^[A-Za-z]{3}$/.test(foreignCurrency.trim()))
    return fail("Foreign currency must be a three-letter code.");
  return {
    success: true,
    data: {
      rowNumber: row.rowNumber,
      date,
      type: type as TransactionKind,
      status: status as TransactionStatus,
      title,
      amount,
      currency: currency.toUpperCase(),
      account,
      category,
      tags,
      note,
      exchangeRate,
      destinationAccount,
      destinationAmount,
      destinationBaseAmountMinor,
      foreignAmount: foreignAmount.trim(),
      foreignCurrency: foreignCurrency.trim().toUpperCase(),
      foreignExchangeRate: foreignExchangeRate.trim(),
      feeKind: feeKind.trim().toLowerCase(),
      feeValue: feeValue.trim(),
    },
  };
}

/**
 * Reads the optional foreign-amount and fee columns of a CSV row. `amountMinor` is the row's
 * total (what `exportCsv` writes). Without a foreign amount the principal is derived back from
 * the total and fee; with one, `buildTransaction` derives it and the caller checks the total.
 */
export function parseCsvForeignAndFee(
  ctx: FinanceContext,
  row: ParsedCsvRow,
  accountCurrency: string,
  amountMinor: number,
): {
  foreign: ForeignAmountInput | null;
  fee: TransactionFeeInput | null;
  principalMinor: number;
} {
  const locale = ctx.formatLocale;
  let foreign: ForeignAmountInput | null = null;
  if (row.foreignAmount || row.foreignCurrency || row.foreignExchangeRate) {
    if (!row.foreignAmount || !row.foreignCurrency)
      throw new Error(
        "Foreign amount and foreign currency must be given together.",
      );
    foreign = {
      amountMinor: parseInvariantMoney(
        row.foreignAmount,
        row.foreignCurrency,
        locale,
      ),
      currency: row.foreignCurrency,
      ...(row.foreignExchangeRate
        ? { exchangeRate: row.foreignExchangeRate }
        : {}),
    };
  }
  let fee: TransactionFeeInput | null = null;
  if (row.feeKind || row.feeValue) {
    if (!row.feeKind || !row.feeValue)
      throw new Error("Fee kind and fee value must be given together.");
    if (row.feeKind === "percent") {
      fee = { kind: "percent", percent: row.feeValue };
    } else if (row.feeKind === "fixed") {
      fee = {
        kind: "fixed",
        amountMinor: parseInvariantMoney(row.feeValue, accountCurrency, locale),
      };
    } else {
      throw new Error("Fee kind must be percent or fixed.");
    }
  }
  if (foreign || !fee || row.type === "transfer") {
    return { foreign, fee, principalMinor: amountMinor };
  }
  // A fee without a foreign amount: the exported amount is the total, so recover the principal.
  const kind = row.type as "expense" | "income";
  const mismatch = () =>
    new Error(
      `Amount ${row.amount} does not match the fee (${row.feeKind} ${row.feeValue}).`,
    );
  if (fee.kind === "fixed") {
    const principal =
      kind === "expense"
        ? amountMinor - fee.amountMinor
        : amountMinor + fee.amountMinor;
    if (!Number.isSafeInteger(principal) || principal <= 0) throw mismatch();
    return { foreign, fee, principalMinor: principal };
  }
  const percent = Number(normalizeFeePercent(fee.percent));
  const estimate =
    kind === "expense"
      ? amountMinor / (1 + percent / 100)
      : amountMinor / (1 - percent / 100);
  if (!Number.isFinite(estimate)) throw mismatch();
  const center = Math.round(estimate);
  for (let delta = 0; delta <= 3; delta += 1) {
    for (const candidate of delta
      ? [center - delta, center + delta]
      : [center]) {
      if (candidate <= 0 || !Number.isSafeInteger(candidate)) continue;
      try {
        if (
          totalWithFee(kind, candidate, feeMinorFor(candidate, fee)) ===
          amountMinor
        )
          return { foreign, fee, principalMinor: candidate };
      } catch {
        // Not a valid principal for this total; try the next candidate.
      }
    }
  }
  throw mismatch();
}

/** A row that passed the preview: the transaction it would become and the tags it names. */
export interface StagedCsvRow {
  input: TransactionInput;
  tagNames: string[];
}

/**
 * Validates every row against the current snapshot and reports which would import, which are
 * rejected and which look like duplicates. Writes nothing: `staged` is what a commit would build.
 */
export async function stageCsvRows(
  ctx: FinanceContext,
  buildTransaction: BuildTransaction,
  rows: CsvImportRow[],
) {
  const result: ImportResult = {
    validRows: [],
    rejectedRows: [],
    duplicateRows: [],
    warnings: [],
    committedIds: [],
  };
  const staged: StagedCsvRow[] = [];
  const duplicateKeys = new Set(
    ctx.state.transactions.map((item) => transactionDuplicateKey(ctx, item)),
  );
  let processed = 0;
  for (const raw of rows) {
    // A big file is thousands of validations on the JS thread. Handing control back every
    // so often keeps scrolling, taps and animations responsive while it runs; small files
    // never reach the first yield.
    if (processed > 0 && processed % CSV_YIELD_EVERY === 0)
      await yieldToEventLoop();
    processed += 1;
    const parsed = parseCsvRow(raw);
    if (!parsed.success) {
      result.rejectedRows.push({
        rowNumber: raw.rowNumber,
        reason: parsed.reason,
      });
      continue;
    }
    const row = parsed.data;
    // Archived accounts are still matched by name so they are reported as archived
    // (below) rather than as "Unknown account", which would read as a corrupt export.
    const account = active(ctx.state.accounts).find(
      (item) => item.name.toLowerCase() === row.account.toLowerCase(),
    );
    if (!account) {
      result.rejectedRows.push({
        rowNumber: row.rowNumber,
        reason: `Unknown account: ${row.account}`,
      });
      continue;
    }
    if (account.archived) {
      result.rejectedRows.push({
        rowNumber: row.rowNumber,
        reason: `Account ${account.name} is archived.`,
      });
      continue;
    }
    try {
      if (row.currency !== account.currency) {
        throw new Error(
          `Currency ${row.currency} does not match ${account.name} (${account.currency}).`,
        );
      }
      const amountMinor = parseInvariantMoney(
        row.amount,
        row.currency,
        ctx.formatLocale,
      );
      const destination = row.destinationAccount
        ? active(ctx.state.accounts).find(
            (item) =>
              item.name.toLowerCase() === row.destinationAccount.toLowerCase(),
          )
        : undefined;
      if (row.type === "transfer" && !destination) {
        result.rejectedRows.push({
          rowNumber: row.rowNumber,
          reason: `Unknown destination account: ${row.destinationAccount || "missing"}`,
        });
        continue;
      }
      if (destination?.archived) {
        result.rejectedRows.push({
          rowNumber: row.rowNumber,
          reason: `Account ${destination.name} is archived.`,
        });
        continue;
      }
      const category = row.category
        ? active(ctx.state.categories).find(
            (item) => item.name.toLowerCase() === row.category.toLowerCase(),
          )
        : undefined;
      if (row.category && !category)
        throw new Error(`Unknown category: ${row.category}`);
      if (category?.archived)
        throw new Error(`Category ${category.name} is archived.`);
      const tagNames = [
        ...new Map(
          row.tags
            .split("|")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((name) => [name.toLowerCase(), name]),
        ).values(),
      ];
      const { foreign, fee, principalMinor } = parseCsvForeignAndFee(
        ctx,
        row,
        account.currency,
        amountMinor,
      );
      const input: TransactionInput = {
        kind: row.type,
        status: row.status,
        title: row.title,
        note: row.note,
        localDate: row.date,
        accountId: account.id,
        destinationAccountId: destination?.id ?? null,
        categoryId: category?.id ?? null,
        tagIds: [],
        amountMinor: principalMinor,
        ...(foreign ? { foreign } : {}),
        ...(fee ? { fee } : {}),
        destinationAmountMinor:
          destination && row.destinationAmount
            ? parseInvariantMoney(
                row.destinationAmount,
                destination.currency,
                ctx.formatLocale,
              )
            : null,
        destinationBaseAmountMinor: row.destinationBaseAmountMinor
          ? parseMinorInteger(
              row.destinationBaseAmountMinor,
              "Destination base amount",
            )
          : null,
        exchangeRate: row.exchangeRate || undefined,
      };
      // Build once during preview so rate and transfer validation errors are reported per row.
      const previewTransaction = buildTransaction(input);
      // The exported `amount` is the total. A breakdown that does not add up to it would
      // silently change the money, so the row is refused instead.
      if ((foreign || fee) && previewTransaction.amountMinor !== amountMinor) {
        throw new Error(
          `Amount ${row.amount} does not match the foreign amount and fee, which total ${minorToDecimalString(
            previewTransaction.amountMinor,
            row.currency,
            ctx.formatLocale,
          )}.`,
        );
      }
      const duplicateKey = transactionDuplicateKey(
        ctx,
        previewTransaction,
        tagNames,
      );
      if (duplicateKeys.has(duplicateKey)) {
        result.duplicateRows.push(row.rowNumber);
        continue;
      }
      duplicateKeys.add(duplicateKey);
      result.validRows.push(row as CsvImportRow);
      staged.push({ input, tagNames });
    } catch (reason) {
      result.rejectedRows.push({
        rowNumber: row.rowNumber,
        reason:
          reason instanceof Error
            ? reason.message
            : "Invalid amount or exchange rate.",
      });
    }
  }
  return { result, staged };
}

/**
 * The transactions a commit writes for the staged rows, and the tags they need that do not exist
 * yet (matched by normalized name, so a tag is created once however many rows name it).
 */
export function buildCsvTransactions(
  ctx: FinanceContext,
  buildTransaction: BuildTransaction,
  staged: StagedCsvRow[],
) {
  const tags = [...ctx.state.tags];
  const newTags: Tag[] = [];
  const transactions = staged.map(({ input, tagNames }) => {
    const tagIds = tagNames.map((name) => {
      const existing = tags.find(
        (item) =>
          !item.deletedAt && normalizeName(item.name) === normalizeName(name),
      );
      if (existing) return existing.id;
      const tag = createEntity({
        id: makeId(),
        name,
        color: "#6D7885",
      }) as Tag;
      tags.push(tag);
      newTags.push(tag);
      return tag.id;
    });
    return buildTransaction(
      { ...input, tagIds },
      undefined,
      tags.map((tag) => tag.id),
    );
  });
  return { newTags, transactions };
}

/** Every transaction as a UTF-8 CSV (with a byte-order mark), oldest first. */
export function buildCsvExport(ctx: FinanceContext) {
  const headers = [
    "date",
    "type",
    "status",
    "title",
    "amount",
    "currency",
    "account",
    "destination_account",
    "destination_amount",
    "destination_base_amount_minor",
    "category",
    "tags",
    "note",
    "exchange_rate",
    "base_amount_minor",
    "transfer_id",
    "foreign_amount",
    "foreign_currency",
    "foreign_exchange_rate",
    "fee_kind",
    "fee_value",
  ];
  const rows = queryTransactions(ctx, { sort: "oldest" }).map((transaction) => {
    const account =
      ctx.state.accounts.find((item) => item.id === transaction.accountId)
        ?.name ?? "";
    const destination = ctx.state.accounts.find(
      (item) => item.id === transaction.destinationAccountId,
    );
    const category =
      ctx.state.categories.find((item) => item.id === transaction.categoryId)
        ?.name ?? "";
    const tags = transaction.tagIds
      .map((id) => ctx.state.tags.find((item) => item.id === id)?.name)
      .filter(Boolean)
      .join("|");
    return [
      transaction.localDate,
      transaction.kind,
      transaction.status,
      transaction.title,
      minorToDecimalString(
        transaction.amountMinor,
        transaction.currency,
        ctx.formatLocale,
      ),
      transaction.currency,
      account,
      destination?.name ?? "",
      transaction.destinationAmountMinor !== null && destination
        ? minorToDecimalString(
            transaction.destinationAmountMinor,
            destination.currency,
            ctx.formatLocale,
          )
        : "",
      transaction.destinationBaseAmountMinor ?? "",
      category,
      tags,
      transaction.note,
      transaction.exchangeRate ?? "",
      transaction.baseAmountMinor ?? "",
      transaction.transferGroupId ?? "",
      transaction.foreign
        ? minorToDecimalString(
            transaction.foreign.amountMinor,
            transaction.foreign.currency,
            ctx.formatLocale,
          )
        : "",
      transaction.foreign?.currency ?? "",
      transaction.foreign?.exchangeRate ?? "",
      transaction.fee?.kind ?? "",
      transaction.fee
        ? transaction.fee.kind === "percent"
          ? (transaction.fee.percent ?? "")
          : minorToDecimalString(
              transaction.fee.amountMinor,
              transaction.currency,
              ctx.formatLocale,
            )
        : "",
    ];
  });
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n")}`;
}
