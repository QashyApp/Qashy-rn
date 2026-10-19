/**
 * Builds the JSON snapshot the native home-screen widgets draw from.
 *
 * Pure: everything it needs arrives as arguments (the repository reads through a narrow
 * `WidgetDataSource`, the translator, the locale, the clock), so it is deterministic and can be
 * tested without a device. The wire format is version 1 and fixed; the native side only renders it.
 *
 * Everything user-visible is already formatted here: the native widgets never see an amount as a
 * number. With `hideAmounts` every amount string is "•••" and the net-worth line is dropped too.
 */

import type {
  Account,
  Category,
  DashboardSummary,
  TransactionQuery,
  TransactionRecord,
} from "@/domain/models";
import { groupTransactionsByDay } from "@/features/transactions/list/sections";
import type { Palette, WidgetPalettes } from "@/features/widgets/palette";
import {
  configFor,
  type WidgetConfig,
  type WidgetSettings,
} from "@/features/widgets/settings";
import {
  dateFormat,
  monthLabel,
  parseLocalDate,
  startOfMonth,
} from "@/utils/date";
import { formatMoney } from "@/utils/money";
import { amountTone } from "@/utils/labels";

import type { PlacedWidget } from "../../../modules/qashy-widgets";

export const SNAPSHOT_VERSION = 1;
export const MAX_WIDGET_ROWS = 30;
/** Shown in place of every amount when "hide amounts" is on. */
export const MASKED_AMOUNT = "•••";

export type RowTone = "positive" | "negative" | "neutral";

export interface SnapshotRow {
  id: string;
  title: string;
  detail: string;
  amount: string;
  tone: RowTone;
}

export interface SnapshotGroup {
  heading: string;
  rows: SnapshotRow[];
}

export interface SnapshotStyle {
  theme: WidgetConfig["theme"];
  mode: WidgetConfig["mode"];
  background: WidgetConfig["background"];
  opacity: number;
  frosted: boolean;
  light: Palette;
  dark: Palette;
}

export interface WidgetSnapshotEntry {
  kind: WidgetConfig["kind"];
  style: SnapshotStyle;
  transactions?: { title: string; groups: SnapshotGroup[] };
  summary?: {
    monthLabel: string;
    netWorth: string;
    spent: string;
    earned: string;
    series: number[] | null;
    seriesStart: string;
    seriesEnd: string;
  };
}

export interface SnapshotLabels {
  netWorth: string;
  spent: string;
  earned: string;
  upcoming: string;
  recent: string;
  add: string;
  empty: string;
  openApp: string;
}

export interface WidgetSnapshot {
  version: typeof SNAPSHOT_VERSION;
  generatedAt: string;
  hideAmounts: boolean;
  labels: SnapshotLabels;
  widgets: Record<string, WidgetSnapshotEntry>;
}

/** The slice of `FinanceRepository` the snapshot reads. */
export interface WidgetDataSource {
  accounts: readonly Account[];
  categories: readonly Category[];
  queryTransactions(query: TransactionQuery): TransactionRecord[];
  getDashboard(
    fromDate: string,
    toDate: string,
  ): Pick<DashboardSummary, "incomeMinor" | "expenseMinor" | "netWorthMinor">;
  getNetWorthSeries(
    months: number,
    today?: string,
  ): {
    baseCurrency: string;
    points: readonly { date: string; baseMinor: number }[];
  };
}

export interface SnapshotInput {
  placed: readonly PlacedWidget[];
  settings: WidgetSettings;
  source: WidgetDataSource;
  /** Resolves the light/dark palettes for one widget's appearance. */
  palettes: (config: WidgetConfig) => WidgetPalettes;
  t: (message: string) => string;
  locale: string;
  /** Local date, `YYYY-MM-DD`. */
  today: string;
  now: Date;
}

function snapshotLabels(t: (message: string) => string): SnapshotLabels {
  return {
    netWorth: t("Net worth"),
    spent: t("Spent"),
    earned: t("Income"),
    upcoming: t("Upcoming"),
    recent: t("Recent activity"),
    add: t("Add transaction"),
    empty: t("No transactions yet"),
    openApp: t("Open Qashy to load your widget"),
  };
}

function buildRow(
  transaction: TransactionRecord,
  accounts: ReadonlyMap<string, Account>,
  categories: ReadonlyMap<string, Category>,
  input: Pick<SnapshotInput, "t" | "locale">,
  hideAmounts: boolean,
): SnapshotRow {
  const { t, locale } = input;
  const isTransfer = transaction.kind === "transfer";
  const isIncome = transaction.kind === "income";
  const category = transaction.categoryId
    ? categories.get(transaction.categoryId)
    : undefined;
  const accountName = (id: string | null) =>
    (id ? accounts.get(id)?.name : undefined) || t("Unknown account");
  // The same fallbacks the transaction list shows.
  const title =
    transaction.title.trim() ||
    category?.name ||
    t(isTransfer ? "Transfer" : "Uncategorized");
  const detail = isTransfer
    ? `${accountName(transaction.accountId)} → ${accountName(transaction.destinationAccountId)}`
    : accountName(transaction.accountId);
  // Signed like the list: expenses negative, income positive, transfers unsigned.
  const signed =
    isIncome || isTransfer ? transaction.amountMinor : -transaction.amountMinor;
  return {
    id: transaction.id,
    title,
    detail,
    amount: hideAmounts
      ? MASKED_AMOUNT
      : formatMoney(signed, transaction.currency, locale, {
          sign: !isTransfer,
        }),
    tone: isTransfer ? "neutral" : amountTone(signed),
  };
}

function buildTransactions(
  config: Extract<WidgetConfig, { kind: "transactions" }>,
  input: SnapshotInput,
  hideAmounts: boolean,
): NonNullable<WidgetSnapshotEntry["transactions"]> {
  const { source, t, locale, today } = input;
  const accounts = new Map(source.accounts.map((a) => [a.id, a]));
  const categories = new Map(source.categories.map((c) => [c.id, c]));
  // A deleted or archived account falls back to all accounts.
  const filter = config.accountId ? accounts.get(config.accountId) : undefined;
  const account =
    filter && !filter.archived && !filter.deletedAt ? filter : null;
  const scope: TransactionQuery = account ? { accountIds: [account.id] } : {};

  const upcoming = source.queryTransactions({
    ...scope,
    statuses: ["upcoming"],
    sort: "oldest",
    limit: MAX_WIDGET_ROWS,
  });
  const room = MAX_WIDGET_ROWS - upcoming.length;
  const posted =
    room > 0
      ? source.queryTransactions({
          ...scope,
          statuses: ["posted"],
          sort: "newest",
          limit: room,
        })
      : [];

  const row = (transaction: TransactionRecord) =>
    buildRow(transaction, accounts, categories, input, hideAmounts);
  const groups: SnapshotGroup[] = [];
  if (upcoming.length)
    groups.push({ heading: t("Upcoming"), rows: upcoming.map(row) });

  // Date headings are the list's own: weekday, short month and day, and the year once it differs.
  const sameYear = (date: string) => date.slice(0, 4) === today.slice(0, 4);
  for (const day of groupTransactionsByDay(posted.slice(0, room))) {
    groups.push({
      heading: dateFormat(
        locale,
        sameYear(day.title)
          ? { weekday: "long", month: "short", day: "numeric" }
          : {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            },
      ).format(parseLocalDate(day.title)),
      rows: day.data.map(row),
    });
  }
  return { title: account ? account.name : t("Transactions"), groups };
}

function buildSummary(
  config: Extract<WidgetConfig, { kind: "summary" }>,
  input: SnapshotInput,
  hideAmounts: boolean,
): NonNullable<WidgetSnapshotEntry["summary"]> {
  const { source, t, locale, today } = input;
  const dashboard = source.getDashboard(startOfMonth(today), today);
  const series = source.getNetWorthSeries(config.graphMonths, today);
  const base = series.baseCurrency;
  const last = series.points[series.points.length - 1];
  const money = (minor: number) =>
    hideAmounts ? MASKED_AMOUNT : formatMoney(minor, base, locale);
  const values = series.points.map((point) => point.baseMinor);
  const first = series.points[0];
  return {
    monthLabel: monthLabel(today, locale),
    netWorth: money(last ? last.baseMinor : dashboard.netWorthMinor),
    spent: money(dashboard.expenseMinor),
    earned: money(dashboard.incomeMinor),
    series: hideAmounts || values.length < 2 ? null : values,
    seriesStart: first
      ? dateFormat(locale, { month: "short", year: "2-digit" }).format(
          parseLocalDate(first.date),
        )
      : "",
    seriesEnd: t("Today"),
  };
}

export function buildWidgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  const { placed, settings, palettes, now } = input;
  const hideAmounts = settings.hideAmounts;
  const widgets: Record<string, WidgetSnapshotEntry> = {};
  for (const widget of placed) {
    const config = configFor(settings, widget.id, widget.kind);
    const colors = palettes(config);
    const style: SnapshotStyle = {
      theme: config.theme,
      mode: config.mode,
      background: config.background,
      opacity: config.opacity,
      frosted: config.frosted,
      light: colors.light,
      dark: colors.dark,
    };
    widgets[String(widget.id)] =
      config.kind === "transactions"
        ? {
            kind: "transactions",
            style,
            transactions: buildTransactions(config, input, hideAmounts),
          }
        : {
            kind: "summary",
            style,
            summary: buildSummary(config, input, hideAmounts),
          };
  }
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    hideAmounts,
    labels: snapshotLabels(input.t),
    widgets,
  };
}
