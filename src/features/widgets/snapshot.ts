/**
 * Builds the JSON snapshot the native home-screen widgets draw from.
 *
 * Pure: everything it needs arrives as arguments (the repository reads through a narrow
 * `WidgetDataSource`, the translator, the locale, the clock), so it is deterministic and can be
 * tested without a device. The wire format is version 3 and fixed; the native side only renders it.
 *
 * Everything user-visible is already formatted here: the native widgets never see an amount as a
 * number. With `hideAmounts` every amount of the quick-add widget is "•••" and the budget widget
 * carries no amount at all (its percentage and pace wording are not amounts).
 */

import type { BudgetStatus, DashboardSummary } from "@/domain/models";
import {
  buildKindPayload,
  type PlacedWidgetRef,
  type WidgetConfig,
} from "@/features/widgets/kinds";
import type { Palette, WidgetPalettes } from "@/features/widgets/palette";
import { configFor, type WidgetSettings } from "@/features/widgets/settings";

export { MASKED_AMOUNT } from "@/features/widgets/kinds/shared";

export const SNAPSHOT_VERSION = 3;

export type BudgetPaceKey = "under" | "onTrack" | "projectedOver" | "over";

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
  /**
   * This month at a glance. A metric the widget does not show is `null`; with hidden amounts the
   * ones it shows are "•••" (in both lengths). Each amount comes in full ("$12,480.00") and
   * compact ("$12.5K") form; the native side picks by the room it has.
   */
  quickAdd?: {
    monthLabel: string;
    netWorth: string | null;
    spent: string | null;
    earned: string | null;
    netWorthCompact: string | null;
    spentCompact: string | null;
    earnedCompact: string | null;
    /** The metric to show when only one fits; `null` when no metric is enabled. */
    primary: "netWorth" | "spent" | "earned" | null;
  };
  /**
   * One budget's progress. `empty` means there is no active budget (then only `name`, the prompt
   * to create one, is meaningful). With hidden amounts `spent`, `limit` and `remaining` are `null`.
   */
  budget?: {
    empty: boolean;
    name: string;
    /** The period in words, e.g. "July 2026" or "Jul 1 – Jul 14". */
    period: string;
    /** Whole percent of the limit spent, 0 to 999. */
    percent: number;
    /** `percent` as a 0 to 1 fill, clamped. */
    progress: number;
    /** How far through the period today is, 0 to 1. */
    elapsed: number;
    /** True once spending is past the limit; drawn with words and a mark, never color alone. */
    over: boolean;
    status: BudgetPaceKey;
    statusText: string;
    spent: string | null;
    limit: string | null;
    /** "$120 left" or "$30 over". */
    remaining: string | null;
    /** The same three amounts, abbreviated ("$1.2K left"), for narrow widgets. */
    spentCompact: string | null;
    limitCompact: string | null;
    remainingCompact: string | null;
  };
}

export interface SnapshotLabels {
  netWorth: string;
  spent: string;
  earned: string;
  add: string;
  openApp: string;
}

export interface WidgetSnapshot {
  version: typeof SNAPSHOT_VERSION;
  generatedAt: string;
  hideAmounts: boolean;
  labels: SnapshotLabels;
  widgets: Record<string, WidgetSnapshotEntry>;
}

/**
 * The slice of `FinanceRepository` the snapshot reads. The reads are the display ones: they count
 * the auto-post recurring occurrences that are due but not generated yet (the headless refresh
 * never generates), which is the caller's to arrange.
 */
export interface WidgetDataSource {
  /** The currency every figure is formatted in. */
  baseCurrency: string;
  getDashboard(
    fromDate: string,
    toDate: string,
  ): Pick<DashboardSummary, "incomeMinor" | "expenseMinor" | "netWorthMinor">;
  /** The budgets active on `onDate`, in the Plan screen's order. */
  getBudgetStatuses(
    onDate: string,
  ): readonly Pick<
    BudgetStatus,
    "budget" | "snapshot" | "spentMinor" | "effectiveLimitMinor"
  >[];
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
    add: t("Add transaction"),
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
