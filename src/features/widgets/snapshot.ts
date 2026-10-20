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
import {
  buildKindPayload,
  type PlacedWidgetRef,
  type WidgetConfig,
} from "@/features/widgets/kinds";
import type { Palette, WidgetPalettes } from "@/features/widgets/palette";
import { configFor, type WidgetSettings } from "@/features/widgets/settings";

export {
  MASKED_AMOUNT,
  MAX_WIDGET_ROWS,
} from "@/features/widgets/kinds/shared";

export const SNAPSHOT_VERSION = 1;

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

/**
 * One placed widget. A kind's own data sits under a key named after the kind (`transactions` for
 * the `transactions` kind), which is what the native `WidgetKind.parse` reads.
 */
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
  placed: readonly PlacedWidgetRef[];
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
    widgets[String(widget.id)] = {
      kind: config.kind,
      style,
      ...buildKindPayload(config, input, hideAmounts),
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
