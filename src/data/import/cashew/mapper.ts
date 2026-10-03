import { Decimal } from "decimal.js";

import { mapCashewCategoryIcon } from "@/data/import/cashew/icon-map";
import {
  ImportError,
  type BalanceCheck,
  type BundleAccount,
  type BundleBudget,
  type BundleCategory,
  type BundleRecurringRule,
  type BundleTag,
  type BundleTransaction,
  type CashewRawData,
  type ImportBundle,
  type ImportWarning,
  type ParseOptions,
  type RawRow,
} from "@/data/import/types";
import type {
  CategoryKind,
  PeriodDefinition,
  RecurrenceUnit,
  TransactionStatus,
} from "@/domain/models";
import { ACCENT_PRESETS, CATEGORY_PALETTE } from "@/theme/tokens";
import { addRecurrence, isLocalDate } from "@/utils/date";
import { currencyDigits, isSupportedCurrencyCode } from "@/utils/money";
import { compareInvariant, normalizeName } from "@/utils/naming";

const DEFAULT_ACCOUNT_ICON = "wallet.bifold";
const DEFAULT_BUDGET_ICON = "chart.pie";
const DEFAULT_TAG_COLOR = "#6D7885";
const DEFAULT_ACCOUNT_COLOR: string = ACCENT_PRESETS[0];
const DEFAULT_BUDGET_COLOR: string = ACCENT_PRESETS[0];

// ---------------------------------------------------------------------------
// Defensive column readers. Cashew versions differ in which columns exist, and
// SQLite happily hands back a number where a string was expected (or the other
// way round), so nothing below trusts a column's declared type.
// ---------------------------------------------------------------------------

function text(row: RawRow, key: string): string | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function num(row: RawRow, key: string): number | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function flag(row: RawRow, key: string): boolean {
  return num(row, key) === 1;
}

function tableRows(raw: CashewRawData, name: string): RawRow[] {
  const rows = raw.tables[name];
  return Array.isArray(rows) ? rows : [];
}

/** Cashew stores lists as JSON text such as `["0","3"]`. Anything unparsable is an empty list. */
function jsonList(row: RawRow, key: string): string[] {
  const value = row[key];
  if (value === undefined || value === null) return [];
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const items: string[] = [];
  for (const item of parsed) {
    if (typeof item === "string" || typeof item === "number") {
      const asText = String(item).trim();
      if (asText !== "") items.push(asText);
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

function convertColor(value: string | null): string | null {
  if (!value) return null;
  const match = /^(?:0x|#)?([0-9a-f]{8}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  return `#${match[1].slice(-6).toUpperCase()}`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

function paletteColor(name: string): string {
  return CATEGORY_PALETTE[hashString(name) % CATEGORY_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Time zone and dates
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new ImportError(
      "unsupported",
      `The time zone "${timeZone}" is not supported on this device.`,
    );
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Unix seconds -> `YYYY-MM-DD` in `timeZone`, or `null` when the value is not a usable date. */
function localDateFromSeconds(
  value: number | null,
  timeZone: string,
): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  // Real backups store seconds. A value this large can only be milliseconds.
  const milliseconds = Math.abs(value) > 1e11 ? value : value * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  let year = "";
  let month = "";
  let day = "";
  for (const part of dateFormatter(timeZone).formatToParts(date)) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  if (!year || !month || !day) return null;
  const result = `${year.padStart(4, "0")}-${month}-${day}`;
  return isLocalDate(result) ? result : null;
}

function resolveTimeZone(raw: CashewRawData, options: ParseOptions) {
  const detected = raw.detectedTimeZone?.trim() || null;
  if (detected) {
    try {
      dateFormatter(detected);
      return { timeZone: detected, timeZoneSource: "backup" as const };
    } catch {
      // A zone the backup recorded but this runtime cannot resolve: use the device's instead.
    }
  }
  dateFormatter(options.fallbackTimeZone);
  return {
    timeZone: options.fallbackTimeZone,
    timeZoneSource: "device" as const,
  };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const exponentCache = new Map<string, number>();

function exponentFor(currency: string): number {
  const cached = exponentCache.get(currency);
  if (cached !== undefined) return cached;
  let exponent: number;
  try {
    exponent = currencyDigits(currency);
  } catch {
    throw new ImportError(
      "unsupported",
      `The currency ${currency} is not supported.`,
    );
  }
  exponentCache.set(currency, exponent);
  return exponent;
}

interface MinorConversion {
  /** Rounded |amount| in minor units, or `null` when it is not a safe integer. */
  minor: number | null;
  /** True when |amount| had more decimals than the currency's exponent. */
  rounded: boolean;
}

/**
 * |amount| in minor units, half away from zero, computed from the number's shortest decimal
 * string. Never multiplies floats: 8.1 * 100 is 809.9999999999999 in IEEE arithmetic.
 */
function toMinor(amount: number, exponent: number): MinorConversion {
  let scaled: Decimal;
  try {
    scaled = new Decimal(String(amount))
      .abs()
      .mul(new Decimal(10).pow(exponent));
  } catch {
    return { minor: null, rounded: false };
  }
  if (!scaled.isFinite()) return { minor: null, rounded: false };
  const rounded = !scaled.isInteger();
  const minor = scaled.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(minor)) return { minor: null, rounded };
  return { minor, rounded };
}

function normalizeCurrency(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return isSupportedCurrencyCode(code) ? code : null;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

class NameRegistry {
  private readonly used = new Set<string>();

  /** Returns `base`, or `base (2)`, `base (3)`, ... when the normalised name is already taken. */
  claim(base: string): string {
    let candidate = base;
    let index = 2;
    while (this.used.has(normalizeName(candidate))) {
      candidate = `${base} (${index})`;
      index += 1;
    }
    this.used.add(normalizeName(candidate));
    return candidate;
  }
}

// ---------------------------------------------------------------------------
// Transaction rows
// ---------------------------------------------------------------------------

interface WalletInfo {
  pk: string;
  externalId: string;
  currency: string;
  exponent: number;
}

interface SourceTransaction {
  pk: string;
  basePk: string;
  index: number;
  walletPk: string;
  sign: 1 | -1;
  amountMinor: number;
  rounded: boolean;
  title: string | null;
  note: string;
  categoryFk: string | null;
  subCategoryFk: string | null;
  dateSec: number;
  localDate: string;
  paid: boolean;
  skipPaid: boolean;
  status: TransactionStatus;
  type: number | null;
  reoccurrence: number | null;
  periodLength: number | null;
  endDateSec: number | null;
  pairedFk: string | null;
}

type RowRejection =
  | "invalid-transaction"
  | "loans-skipped"
  | "missing-wallet"
  | "invalid-amount"
  | "zero-amount"
  | "invalid-date";

type RowParse =
  { ok: true; row: SourceTransaction } | { ok: false; reason: RowRejection };

const PREDICT_SUFFIX = /::predict::\d+$/;

function statusOf(paid: boolean, skipPaid: boolean): TransactionStatus {
  if (paid) return "posted";
  return skipPaid ? "skipped" : "upcoming";
}

/**
 * The one place that decides whether a raw transaction row is importable. Both the mapper and
 * the independent balance reconciliation call it, so "skipped and reported" means the same
 * thing to each.
 */
function parseTransactionRow(
  row: RawRow,
  index: number,
  wallets: ReadonlyMap<string, WalletInfo>,
  timeZone: string,
): RowParse {
  const pk = text(row, "transaction_pk");
  if (pk === null) return { ok: false, reason: "invalid-transaction" };
  const type = num(row, "type");
  if (type === 3 || type === 4 || text(row, "objective_loan_fk") !== null) {
    return { ok: false, reason: "loans-skipped" };
  }
  const walletPk = text(row, "wallet_fk");
  const wallet = walletPk === null ? undefined : wallets.get(walletPk);
  if (walletPk === null || !wallet)
    return { ok: false, reason: "missing-wallet" };
  const amount = num(row, "amount");
  if (amount === null) return { ok: false, reason: "invalid-amount" };
  if (amount === 0) return { ok: false, reason: "zero-amount" };
  const converted = toMinor(amount, wallet.exponent);
  if (converted.minor === null || converted.minor <= 0)
    return { ok: false, reason: "invalid-amount" };
  const dateSec = num(row, "date_created");
  const localDate = localDateFromSeconds(dateSec, timeZone);
  if (dateSec === null || localDate === null)
    return { ok: false, reason: "invalid-date" };
  const paid = flag(row, "paid");
  const skipPaid = flag(row, "skip_paid");
  const endDateSec = num(row, "end_date");
  return {
    ok: true,
    row: {
      pk,
      basePk: pk.replace(PREDICT_SUFFIX, ""),
      index,
      walletPk,
      sign: amount < 0 ? -1 : 1,
      amountMinor: converted.minor,
      rounded: converted.rounded,
      title: text(row, "name"),
      note: text(row, "note") ?? "",
      categoryFk: text(row, "category_fk"),
      subCategoryFk: text(row, "sub_category_fk"),
      dateSec,
      localDate,
      paid,
      skipPaid,
      status: statusOf(paid, skipPaid),
      type,
      reoccurrence: num(row, "reoccurrence"),
      periodLength: num(row, "period_length"),
      endDateSec,
      pairedFk: text(row, "paired_transaction_fk"),
    },
  };
}

function periodOf(
  reoccurrence: number | null,
  periodLength: number | null,
): { unit: RecurrenceUnit; interval: number } | null {
  const unit: RecurrenceUnit | null =
    reoccurrence === 1
      ? "day"
      : reoccurrence === 2
        ? "week"
        : reoccurrence === 3
          ? "month"
          : reoccurrence === 4
            ? "year"
            : null;
  if (unit === null) return null;
  const interval =
    periodLength !== null && Number.isFinite(periodLength)
      ? Math.max(1, Math.floor(periodLength))
      : 1;
  return { unit, interval };
}

const compareByDate = (first: SourceTransaction, second: SourceTransaction) =>
  first.dateSec - second.dateSec || first.index - second.index;

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Sums each wallet's paid raw amounts straight from the source rows: per-row rounded minor
 * units, signed by the raw amount's sign. It shares only the row-eligibility predicate and the
 * rounding rule with the mapper; pairing, grouping and status handling play no part.
 */
export function computeSourceBalances(
  raw: CashewRawData,
  accounts: readonly BundleAccount[],
  timeZone: string,
): Map<string, number> {
  const wallets = new Map<string, WalletInfo>();
  for (const account of accounts) {
    const pk = account.externalId.replace(/^wallet:/, "");
    wallets.set(pk, {
      pk,
      externalId: account.externalId,
      currency: account.currency,
      exponent: exponentFor(account.currency),
    });
  }
  const balances = new Map<string, number>(
    accounts.map((account) => [account.externalId, 0]),
  );
  tableRows(raw, "transactions").forEach((row, index) => {
    const parsed = parseTransactionRow(row, index, wallets, timeZone);
    if (!parsed.ok || !parsed.row.paid) return;
    const wallet = wallets.get(parsed.row.walletPk);
    if (!wallet) return;
    const next =
      (balances.get(wallet.externalId) ?? 0) +
      parsed.row.sign * parsed.row.amountMinor;
    if (!Number.isSafeInteger(next)) throw tooLarge();
    balances.set(wallet.externalId, next);
  });
  return balances;
}

function tooLarge() {
  return new ImportError(
    "unsupported",
    "Amounts in this backup are too large to import.",
  );
}

/** Signed sum of an account's posted transactions in the bundle. */
function importedBalances(
  accounts: readonly BundleAccount[],
  transactions: readonly BundleTransaction[],
): Map<string, number> {
  const balances = new Map<string, number>(
    accounts.map((account) => [account.externalId, 0]),
  );
  const apply = (accountExternalId: string | null, delta: number) => {
    if (accountExternalId === null || !balances.has(accountExternalId)) return;
    const next = (balances.get(accountExternalId) ?? 0) + delta;
    if (!Number.isSafeInteger(next)) throw tooLarge();
    balances.set(accountExternalId, next);
  };
  for (const transaction of transactions) {
    if (transaction.status !== "posted") continue;
    if (transaction.kind === "income")
      apply(transaction.accountExternalId, transaction.amountMinor);
    else if (transaction.kind === "expense")
      apply(transaction.accountExternalId, -transaction.amountMinor);
    else {
      apply(transaction.accountExternalId, -transaction.amountMinor);
      apply(
        transaction.destinationAccountExternalId,
        transaction.destinationAmountMinor ?? 0,
      );
    }
  }
  return balances;
}

/**
 * Compares each account's balance recomputed from the source against the balance of the
 * bundle's posted transactions. Any difference means the mapping lost or invented money, so the
 * whole import is refused; there is deliberately no tolerance.
 */
export function reconcileBalances(
  accounts: readonly BundleAccount[],
  transactions: readonly BundleTransaction[],
  sourceBalances: ReadonlyMap<string, number>,
): BalanceCheck[] {
  const imported = importedBalances(accounts, transactions);
  const checks = accounts.map<BalanceCheck>((account) => ({
    accountExternalId: account.externalId,
    name: account.name,
    currency: account.currency,
    sourceBalanceMinor: sourceBalances.get(account.externalId) ?? 0,
    importedBalanceMinor: imported.get(account.externalId) ?? 0,
  }));
  if (
    checks.some(
      (check) => check.sourceBalanceMinor !== check.importedBalanceMinor,
    )
  ) {
    throw new ImportError(
      "reconciliation-failed",
      "Account balances did not match the backup, so nothing was imported.",
    );
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

const WARNING_MESSAGES: Record<string, string> = {
  "rounded-amounts":
    "Some amounts had more decimal places than their currency allows and were rounded.",
  "zero-amount": "Transactions with a zero amount were not imported.",
  "invalid-amount":
    "Transactions with an unreadable or out-of-range amount were not imported.",
  "invalid-date": "Transactions with an unreadable date were not imported.",
  "invalid-transaction":
    "Transaction rows without an identifier were not imported.",
  "missing-wallet":
    "Transactions that belong to an account missing from the backup were not imported.",
  "missing-category":
    "Some transactions reference a category missing from the backup and were imported without one.",
  "empty-title":
    "Transactions without a name were titled after their category.",
  "category-split":
    "Some transactions did not match their category’s type, so a matching category was created for them.",
  "subcategory-flattened":
    "Some subcategories could not keep their parent and were imported as top-level categories.",
  "wallet-currency-default":
    "Accounts with a missing or unsupported currency use your base currency.",
  "loans-skipped": "Loans and credit/debt entries were not imported.",
  "objectives-not-imported":
    "Cashew objectives were not imported; their transactions were kept without the objective link.",
  "transfer-unpaired":
    "Some transfers could not be matched to both accounts and were imported as regular transactions.",
  "recurring-custom-period":
    "Recurring transactions with a custom period cannot be scheduled and were imported as regular transactions.",
  "recurring-ended":
    "Subscriptions and repeating transactions with no upcoming entry in Cashew were treated as ended: their past payments were imported, but no schedule was created.",
  "recurring-stale":
    "Subscriptions and repeating transactions whose upcoming entry in Cashew was overdue by more than a full period were treated as stopped: their past payments were imported, but no schedule was created.",
  "recurring-review":
    "Recurring transactions were imported as schedules that ask for your review before posting.",
  "shared-budget-flattened":
    "Shared budgets were imported as ordinary budgets without sharing.",
  "invalid-budget":
    "Budgets with an invalid limit, period or category selection were not imported.",
  "budget-exclusions-flattened":
    "Budget category exclusions were converted into an explicit category list.",
  "budget-filters-dropped":
    "Budget transaction-type filters were not imported.",
  "budget-manual-only":
    "Budgets that only count manually added transactions now count all matching transactions.",
  "budget-absolute-limit":
    "Budgets with an absolute spending limit were imported as regular budgets.",
  "budget-currency":
    "Budget limits were imported in your base currency, which differs from some account currencies.",
  "associated-titles-dropped":
    "Cashew’s remembered title suggestions were not imported.",
  "scanner-templates-dropped":
    "Cashew’s email scanner templates were not imported.",
};

class WarningCounter {
  private readonly counts = new Map<string, number>();

  add(code: string, amount = 1) {
    if (amount > 0)
      this.counts.set(code, (this.counts.get(code) ?? 0) + amount);
  }

  toList(): ImportWarning[] {
    return [...this.counts.entries()]
      .map<ImportWarning>(([code, count]) => ({
        code,
        message: WARNING_MESSAGES[code] ?? code,
        count,
      }))
      .sort(
        (first, second) =>
          second.count - first.count ||
          compareInvariant(first.code, second.code),
      );
  }
}

// ---------------------------------------------------------------------------
// The mapper
// ---------------------------------------------------------------------------

interface CategoryInfo {
  pk: string;
  externalId: string;
  kind: CategoryKind;
  /** The source name before de-duplication, used as a title fallback. */
  sourceName: string;
  name: string;
  icon: string;
  color: string;
  archived: boolean;
  parentPk: string | null;
  parentExternalId: string | null;
}

interface GroupPlan {
  mode: "rule" | "finished" | "custom";
  ruleExternalId: string | null;
}

export function mapCashewBackup(
  raw: CashewRawData,
  options: ParseOptions,
): ImportBundle {
  const warnings = new WarningCounter();
  const { timeZone, timeZoneSource } = resolveTimeZone(raw, options);
  const today =
    options.today !== undefined && isLocalDate(options.today)
      ? options.today
      : (localDateFromSeconds(Date.now() / 1000, timeZone) as string);

  const fallbackCurrency = normalizeCurrency(options.fallbackCurrency);
  if (!fallbackCurrency) {
    throw new ImportError(
      "unsupported",
      `The currency ${options.fallbackCurrency} is not supported.`,
    );
  }

  // Accounts ---------------------------------------------------------------
  const accountNames = new NameRegistry();
  const accounts: BundleAccount[] = [];
  const wallets = new Map<string, WalletInfo>();
  let walletCurrencyDefaults = 0;
  for (const row of tableRows(raw, "wallets")) {
    const pk = text(row, "wallet_pk");
    if (pk === null || wallets.has(pk)) continue;
    const declared = normalizeCurrency(text(row, "currency"));
    if (!declared) walletCurrencyDefaults += 1;
    const currency = declared ?? fallbackCurrency;
    const externalId = `wallet:${pk}`;
    accounts.push({
      externalId,
      name: accountNames.claim(text(row, "name") ?? "Account"),
      type: "checking",
      currency,
      openingBalanceMinor: 0,
      icon: DEFAULT_ACCOUNT_ICON,
      color: convertColor(text(row, "colour")) ?? DEFAULT_ACCOUNT_COLOR,
      archived: flag(row, "archived"),
    });
    wallets.set(pk, {
      pk,
      externalId,
      currency,
      exponent: exponentFor(currency),
    });
  }
  warnings.add("wallet-currency-default", walletCurrencyDefaults);

  // Categories -------------------------------------------------------------
  const categoryNames = new NameRegistry();
  const categoryInfos = new Map<string, CategoryInfo>();
  const categoryRows = tableRows(raw, "categories");
  for (const row of categoryRows) {
    const pk = text(row, "category_pk");
    if (pk === null || categoryInfos.has(pk)) continue;
    const kind: CategoryKind = flag(row, "income") ? "income" : "expense";
    const sourceName = text(row, "name") ?? "Category";
    categoryInfos.set(pk, {
      pk,
      externalId: `category:${pk}`,
      kind,
      sourceName,
      name: categoryNames.claim(sourceName),
      icon: mapCashewCategoryIcon(text(row, "icon_name"), kind),
      color: convertColor(text(row, "colour")) ?? paletteColor(sourceName),
      archived: flag(row, "archived"),
      parentPk: text(row, "main_category_pk"),
      parentExternalId: null,
    });
  }
  let flattenedSubcategories = 0;
  for (const info of categoryInfos.values()) {
    if (info.parentPk === null) continue;
    const parent = categoryInfos.get(info.parentPk);
    const parentIsTopLevel = parent !== undefined && parent.parentPk === null;
    if (
      parent &&
      parent.pk !== info.pk &&
      parent.kind === info.kind &&
      parentIsTopLevel
    ) {
      info.parentExternalId = parent.externalId;
    } else {
      flattenedSubcategories += 1;
    }
  }
  warnings.add("subcategory-flattened", flattenedSubcategories);

  const twinCategories = new Map<string, BundleCategory>();
  let categorySplits = 0;

  /** The category a transaction of `kind` should use, creating a twin when kinds disagree. */
  const resolveCategory = (
    row: SourceTransaction,
    kind: CategoryKind,
  ): { externalId: string | null; sourceName: string | null } => {
    const sub =
      row.subCategoryFk === null
        ? undefined
        : categoryInfos.get(row.subCategoryFk);
    const main =
      row.categoryFk === null ? undefined : categoryInfos.get(row.categoryFk);
    const info = sub ?? main;
    if (!info) {
      warnings.add("missing-category");
      return { externalId: null, sourceName: null };
    }
    if (info.kind === kind)
      return { externalId: info.externalId, sourceName: info.sourceName };
    const externalId = `${info.externalId}:${kind}`;
    if (!twinCategories.has(externalId)) {
      twinCategories.set(externalId, {
        externalId,
        name: categoryNames.claim(`${info.sourceName} (${kind})`),
        kind,
        icon: info.icon,
        color: info.color,
        parentExternalId: null,
        archived: info.archived,
      });
    }
    categorySplits += 1;
    return { externalId, sourceName: info.sourceName };
  };

  // Tags -------------------------------------------------------------------
  const tagNames = new NameRegistry();
  const tags: BundleTag[] = [];
  const tagPks = new Set<string>();
  for (const row of tableRows(raw, "tags")) {
    const pk = text(row, "tag_pk");
    if (pk === null || tagPks.has(pk)) continue;
    tagPks.add(pk);
    tags.push({
      externalId: `tag:${pk}`,
      name: tagNames.claim(text(row, "name") ?? "Tag"),
      color: convertColor(text(row, "colour")) ?? DEFAULT_TAG_COLOR,
    });
  }
  const tagLinks = new Map<string, string[]>();
  for (const row of tableRows(raw, "transaction_to_tag_links")) {
    const transactionPk = text(row, "transaction_pk");
    const tagPk = text(row, "tag_pk");
    if (transactionPk === null || tagPk === null || !tagPks.has(tagPk))
      continue;
    const externalId = `tag:${tagPk}`;
    const existing = tagLinks.get(transactionPk);
    if (!existing) tagLinks.set(transactionPk, [externalId]);
    else if (!existing.includes(externalId)) existing.push(externalId);
  }
  const tagsOf = (row: SourceTransaction) => [...(tagLinks.get(row.pk) ?? [])];

  // Transaction rows -------------------------------------------------------
  const sourceRows: SourceTransaction[] = [];
  const seenPks = new Set<string>();
  const roundedRows = { count: 0 };
  tableRows(raw, "transactions").forEach((row, index) => {
    const parsed = parseTransactionRow(row, index, wallets, timeZone);
    if (!parsed.ok) {
      warnings.add(parsed.reason);
      return;
    }
    if (seenPks.has(parsed.row.pk)) {
      warnings.add("invalid-transaction");
      return;
    }
    seenPks.add(parsed.row.pk);
    if (parsed.row.rounded) roundedRows.count += 1;
    sourceRows.push(parsed.row);
  });
  warnings.add("rounded-amounts", roundedRows.count);

  const rowsByPk = new Map(sourceRows.map((row) => [row.pk, row]));
  const walletOf = (row: SourceTransaction) =>
    wallets.get(row.walletPk) as WalletInfo;

  // Transfers: a pair of opposite-signed rows in different accounts becomes one transfer.
  const claimed = new Set<string>();
  const transferDestinations = new Map<string, SourceTransaction>();
  for (const first of sourceRows) {
    if (first.pairedFk === null || claimed.has(first.pk)) continue;
    const second = rowsByPk.get(first.pairedFk);
    const valid =
      second !== undefined &&
      second.pk !== first.pk &&
      !claimed.has(second.pk) &&
      (second.pairedFk === first.pk || second.pairedFk === null) &&
      first.sign !== second.sign &&
      first.walletPk !== second.walletPk &&
      first.status === second.status;
    if (!valid) continue;
    claimed.add(first.pk);
    claimed.add(second.pk);
    const source = first.sign < 0 ? first : second;
    transferDestinations.set(source.pk, source === first ? second : first);
  }
  const destinationPks = new Set(
    [...transferDestinations.values()].map((row) => row.pk),
  );
  warnings.add(
    "transfer-unpaired",
    sourceRows.filter((row) => row.pairedFk !== null && !claimed.has(row.pk))
      .length,
  );

  // Recurring series --------------------------------------------------------
  // Cashew gives every paid occurrence of a subscription its own pk and creates the next
  // upcoming entry as a fresh row, so occurrences are tied together by what they share
  // rather than by pk. Rows that carry an explicit `::predict::` suffix keep their base pk.
  const predictBases = new Set(
    sourceRows.filter((row) => row.pk !== row.basePk).map((row) => row.basePk),
  );
  const seriesKey = (row: SourceTransaction) =>
    predictBases.has(row.basePk)
      ? `pk:${row.basePk}`
      : JSON.stringify([
          row.walletPk,
          row.type,
          row.sign,
          row.reoccurrence,
          row.periodLength,
          normalizeName(row.title ?? ""),
          row.categoryFk,
          row.subCategoryFk,
        ]);
  const groups = new Map<string, SourceTransaction[]>();
  const groupOf = new Map<string, string>();
  for (const row of sourceRows) {
    if (claimed.has(row.pk) || (row.type !== 1 && row.type !== 2)) continue;
    const key = seriesKey(row);
    groupOf.set(row.pk, key);
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }

  const recurringRules: BundleRecurringRule[] = [];
  const plans = new Map<string, GroupPlan>();
  let customPeriodGroups = 0;
  let endedGroups = 0;
  let staleGroups = 0;
  const titleFor = (
    row: SourceTransaction,
    categoryName: string | null,
    fallback: string,
  ) => row.title ?? categoryName ?? fallback;

  for (const [groupKey, members] of groups) {
    const ordered = [...members].sort(compareByDate);
    const latest = ordered[ordered.length - 1];
    const period = periodOf(latest.reoccurrence, latest.periodLength);
    if (!period) {
      customPeriodGroups += 1;
      plans.set(groupKey, { mode: "custom", ruleExternalId: null });
      continue;
    }
    // Cashew cancels a series by deleting its upcoming entry, so a series with none is ended.
    // Only a series that still has an unpaid, unskipped entry becomes a schedule.
    const unpaid = ordered.filter((row) => !row.paid && !row.skipPaid);
    if (unpaid.length === 0) {
      endedGroups += 1;
      plans.set(groupKey, { mode: "finished", ruleExternalId: null });
      continue;
    }
    const nextDueDate = unpaid[0].localDate;
    const endSeconds =
      latest.endDateSec ??
      ordered.find((row) => row.endDateSec !== null)?.endDateSec ??
      null;
    const endDate = localDateFromSeconds(endSeconds, timeZone);
    if (endDate !== null && (nextDueDate > endDate || endDate < today)) {
      endedGroups += 1;
      plans.set(groupKey, { mode: "finished", ruleExternalId: null });
      continue;
    }
    // Stopping a subscription in Cashew often just leaves its last upcoming entry overdue.
    // Scheduling that would back-fill every missed period, so an entry overdue by more than
    // one full period means the series was abandoned.
    if (addRecurrence(nextDueDate, period.unit, period.interval) < today) {
      staleGroups += 1;
      plans.set(groupKey, { mode: "finished", ruleExternalId: null });
      continue;
    }
    const kind = latest.sign < 0 ? "expense" : "income";
    const category = resolveCategory(latest, kind);
    // Keyed by the upcoming entry, as earlier imports were, so re-importing merges cleanly.
    const externalId = `recurring:${unpaid[0].basePk}`;
    recurringRules.push({
      externalId,
      kind,
      title: titleFor(latest, category.sourceName, "Recurring transaction"),
      note: latest.note,
      accountExternalId: walletOf(latest).externalId,
      categoryExternalId: category.externalId,
      tagExternalIds: tagsOf(latest),
      amountMinor: latest.amountMinor,
      currency: walletOf(latest).currency,
      unit: period.unit,
      interval: period.interval,
      startDate: nextDueDate,
      endDate,
      nextDueDate,
      autoPost: false,
      active: true,
    });
    plans.set(groupKey, { mode: "rule", ruleExternalId: externalId });
  }
  warnings.add("recurring-custom-period", customPeriodGroups);
  warnings.add("recurring-ended", endedGroups);
  warnings.add("recurring-stale", staleGroups);
  warnings.add("recurring-review", recurringRules.length);

  // Transactions -----------------------------------------------------------
  const transactions: BundleTransaction[] = [];
  let emptyTitles = 0;
  for (const row of sourceRows) {
    if (destinationPks.has(row.pk)) continue;
    const wallet = walletOf(row);
    const destination = transferDestinations.get(row.pk);
    if (destination) {
      const destinationWallet = walletOf(destination);
      if (row.title === null) emptyTitles += 1;
      transactions.push({
        externalId: `transaction:${row.pk}`,
        kind: "transfer",
        status: row.status,
        title: row.title ?? "Transfer",
        note: row.note,
        localDate: row.localDate,
        accountExternalId: wallet.externalId,
        destinationAccountExternalId: destinationWallet.externalId,
        categoryExternalId: null,
        tagExternalIds: tagsOf(row),
        amountMinor: row.amountMinor,
        destinationAmountMinor: destination.amountMinor,
        recurringRuleExternalId: null,
      });
      continue;
    }
    const groupKey = groupOf.get(row.pk);
    const plan = groupKey === undefined ? undefined : plans.get(groupKey);
    // A live series regenerates its own unpaid occurrences, and a finished series has none left.
    if (plan && plan.mode !== "custom" && row.status === "upcoming") continue;
    const kind = row.sign < 0 ? "expense" : "income";
    const category = resolveCategory(row, kind);
    if (row.title === null) emptyTitles += 1;
    transactions.push({
      externalId: `transaction:${row.pk}`,
      kind,
      status: row.status,
      title: titleFor(row, category.sourceName, "Transaction"),
      note: row.note,
      localDate: row.localDate,
      accountExternalId: wallet.externalId,
      destinationAccountExternalId: null,
      categoryExternalId: category.externalId,
      tagExternalIds: tagsOf(row),
      amountMinor: row.amountMinor,
      destinationAmountMinor: null,
      recurringRuleExternalId:
        plan?.mode === "rule" && row.status === "posted"
          ? plan.ruleExternalId
          : null,
    });
  }
  warnings.add("empty-title", emptyTitles);
  warnings.add("category-split", categorySplits);

  // Emitted categories: parents before children, then twins.
  const sourceCategories: BundleCategory[] = [...categoryInfos.values()].map(
    (info) => ({
      externalId: info.externalId,
      name: info.name,
      kind: info.kind,
      icon: info.icon,
      color: info.color,
      parentExternalId: info.parentExternalId,
      archived: info.archived,
    }),
  );
  const categories: BundleCategory[] = [
    ...sourceCategories.filter(
      (category) => category.parentExternalId === null,
    ),
    ...sourceCategories.filter(
      (category) => category.parentExternalId !== null,
    ),
    ...twinCategories.values(),
  ];

  // Budgets ----------------------------------------------------------------
  const expenseCategoryIds = categories
    .filter((category) => category.kind === "expense")
    .map((category) => category.externalId);
  const expenseCategorySet = new Set(expenseCategoryIds);
  const budgetLimitExponent = exponentFor(fallbackCurrency);
  const limitRowsByBudget = new Map<string, RawRow[]>();
  for (const row of tableRows(raw, "category_budget_limits")) {
    const budgetPk = text(row, "budget_fk");
    if (budgetPk === null) continue;
    const list = limitRowsByBudget.get(budgetPk);
    if (list) list.push(row);
    else limitRowsByBudget.set(budgetPk, [row]);
  }
  const budgets: BundleBudget[] = [];
  const budgetPks = new Set<string>();
  const budgetCounters = {
    invalid: 0,
    shared: 0,
    exclusions: 0,
    filters: 0,
    manualOnly: 0,
    absolute: 0,
  };
  for (const row of tableRows(raw, "budgets")) {
    const pk = text(row, "budget_pk");
    if (pk === null || budgetPks.has(pk)) continue;
    budgetPks.add(pk);

    const amount = num(row, "amount");
    const limit = amount === null ? null : toMinor(amount, budgetLimitExponent);
    const startSec = num(row, "start_date");
    const anchorDate = localDateFromSeconds(startSec, timeZone);
    if (
      amount === null ||
      amount <= 0 ||
      limit === null ||
      limit.minor === null ||
      limit.minor <= 0 ||
      anchorDate === null
    ) {
      budgetCounters.invalid += 1;
      continue;
    }

    const recurrence = periodOf(
      num(row, "reoccurrence"),
      num(row, "period_length"),
    );
    let period: PeriodDefinition;
    if (recurrence) {
      period = {
        unit: recurrence.unit,
        interval: recurrence.interval,
        anchorDate,
        endDate: null,
      };
    } else {
      const endDate = localDateFromSeconds(num(row, "end_date"), timeZone);
      if (endDate === null || endDate < anchorDate) {
        budgetCounters.invalid += 1;
        continue;
      }
      period = { unit: "custom", interval: 1, anchorDate, endDate };
    }

    const accountExternalIds = jsonList(row, "wallet_fks")
      .filter((walletPk) => wallets.has(walletPk))
      .map((walletPk) => `wallet:${walletPk}`);

    const listed = jsonList(row, "category_fks");
    const listedExpense = [
      ...new Set(listed.map((categoryPk) => `category:${categoryPk}`)),
    ].filter((externalId) => expenseCategorySet.has(externalId));
    const excluded = new Set(
      jsonList(row, "category_fks_exclude").map(
        (categoryPk) => `category:${categoryPk}`,
      ),
    );
    if (listed.length > 0 && listedExpense.length === 0) {
      budgetCounters.invalid += 1;
      continue;
    }
    let categoryExternalIds = listed.length > 0 ? listedExpense : [];
    if (excluded.size > 0) {
      const pool = listed.length > 0 ? listedExpense : expenseCategoryIds;
      categoryExternalIds = pool.filter(
        (externalId) => !excluded.has(externalId),
      );
      if (categoryExternalIds.length === 0) {
        budgetCounters.invalid += 1;
        continue;
      }
      budgetCounters.exclusions += 1;
    }

    const categoryLimits: { categoryExternalId: string; limitMinor: number }[] =
      [];
    for (const limitRow of limitRowsByBudget.get(pk) ?? []) {
      const categoryPk = text(limitRow, "category_fk");
      const limitAmount = num(limitRow, "amount");
      if (categoryPk === null || limitAmount === null || limitAmount <= 0)
        continue;
      const categoryExternalId = `category:${categoryPk}`;
      if (!expenseCategorySet.has(categoryExternalId)) continue;
      if (
        categoryLimits.some(
          (entry) => entry.categoryExternalId === categoryExternalId,
        )
      )
        continue;
      const converted = toMinor(limitAmount, budgetLimitExponent);
      if (converted.minor === null || converted.minor <= 0) continue;
      categoryLimits.push({ categoryExternalId, limitMinor: converted.minor });
    }
    if (categoryLimits.length > 0) {
      if (categoryExternalIds.length === 0) {
        categoryExternalIds = [...expenseCategoryIds];
      } else {
        for (const entry of categoryLimits) {
          if (!categoryExternalIds.includes(entry.categoryExternalId)) {
            categoryExternalIds.push(entry.categoryExternalId);
          }
        }
      }
    }

    if (text(row, "shared_key") !== null) budgetCounters.shared += 1;
    if (jsonList(row, "budget_transaction_filters").length > 0)
      budgetCounters.filters += 1;
    if (flag(row, "added_transactions_only")) budgetCounters.manualOnly += 1;
    if (flag(row, "is_absolute_spending_limit")) budgetCounters.absolute += 1;

    budgets.push({
      externalId: `budget:${pk}`,
      name: text(row, "name") ?? "Budget",
      icon: DEFAULT_BUDGET_ICON,
      color: convertColor(text(row, "colour")) ?? DEFAULT_BUDGET_COLOR,
      limitMinor: limit.minor,
      period,
      accountExternalIds: [...new Set(accountExternalIds)],
      categoryExternalIds,
      tagExternalIds: [],
      categoryLimits,
      archived: flag(row, "archived"),
    });
  }
  warnings.add("invalid-budget", budgetCounters.invalid);
  warnings.add("shared-budget-flattened", budgetCounters.shared);
  warnings.add("budget-exclusions-flattened", budgetCounters.exclusions);
  warnings.add("budget-filters-dropped", budgetCounters.filters);
  warnings.add("budget-manual-only", budgetCounters.manualOnly);
  warnings.add("budget-absolute-limit", budgetCounters.absolute);
  if (
    budgets.length > 0 &&
    accounts.some((account) => account.currency !== fallbackCurrency)
  ) {
    warnings.add("budget-currency", budgets.length);
  }

  // Dropped data -----------------------------------------------------------
  warnings.add("objectives-not-imported", tableRows(raw, "objectives").length);
  warnings.add(
    "associated-titles-dropped",
    tableRows(raw, "associated_titles").length,
  );
  warnings.add(
    "scanner-templates-dropped",
    tableRows(raw, "scanner_templates").length,
  );

  // Reconciliation ---------------------------------------------------------
  const balanceChecks = reconcileBalances(
    accounts,
    transactions,
    computeSourceBalances(raw, accounts, timeZone),
  );

  return {
    source: "cashew",
    timeZone,
    timeZoneSource,
    accounts,
    categories,
    tags,
    transactions,
    recurringRules,
    budgets,
    report: {
      counts: {
        accounts: accounts.length,
        categories: categories.length,
        tags: tags.length,
        transactions: transactions.length,
        recurringRules: recurringRules.length,
        budgets: budgets.length,
      },
      warnings: warnings.toList(),
      balanceChecks,
    },
  };
}
