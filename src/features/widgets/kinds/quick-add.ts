import { MASKED_AMOUNT, oneOf } from "@/features/widgets/kinds/shared";
import type { WidgetKindDefinition } from "@/features/widgets/kinds/types";
import type { WidgetAppearance } from "@/features/widgets/settings";
import type { SnapshotInput } from "@/features/widgets/snapshot";
import { monthLabel, startOfMonth } from "@/utils/date";
import { formatMoney } from "@/utils/money";

export const QUICK_ADD_METRICS = ["netWorth", "spent", "earned"] as const;
export type QuickAddMetric = (typeof QUICK_ADD_METRICS)[number];

export interface QuickAddWidgetConfig extends WidgetAppearance {
  kind: "quickAdd";
  showNetWorth: boolean;
  showSpent: boolean;
  showEarned: boolean;
  /** The one metric shown when only one fits (a small widget); see `resolvePrimaryMetric`. */
  primaryMetric: QuickAddMetric;
}

/**
 * The metric a small widget shows: the chosen one while it is enabled, else the first enabled one
 * (net worth, spent, income), else `null` (nothing is enabled: the widget is just the add button).
 */
export function resolvePrimaryMetric(
  config: Pick<
    QuickAddWidgetConfig,
    "showNetWorth" | "showSpent" | "showEarned" | "primaryMetric"
  >,
): QuickAddMetric | null {
  const enabled: Record<QuickAddMetric, boolean> = {
    netWorth: config.showNetWorth,
    spent: config.showSpent,
    earned: config.showEarned,
  };
  if (enabled[config.primaryMetric]) return config.primaryMetric;
  return QUICK_ADD_METRICS.find((metric) => enabled[metric]) ?? null;
}

function flag(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function buildQuickAdd(
  config: QuickAddWidgetConfig,
  input: SnapshotInput,
  hideAmounts: boolean,
) {
  const { source, locale, today } = input;
  // Read the way the overview reads this month, plus the due auto-post occurrences the headless
  // path has not generated (the source decides whether to include them).
  const dashboard = source.getDashboard(startOfMonth(today), today);
  // Every amount comes in two lengths: the full one, and an abbreviated one ("$12.5K") for
  // where the widget is too narrow. Both are masked when amounts are hidden.
  const money = (minor: number, compact: boolean) =>
    hideAmounts
      ? MASKED_AMOUNT
      : formatMoney(minor, source.baseCurrency, locale, { compact });
  // A metric that is switched off is `null`, and so is never computed into the snapshot.
  const metric = (show: boolean, minor: number, compact: boolean) =>
    show ? money(minor, compact) : null;
  return {
    monthLabel: monthLabel(today, locale),
    netWorth: metric(config.showNetWorth, dashboard.netWorthMinor, false),
    spent: metric(config.showSpent, dashboard.expenseMinor, false),
    earned: metric(config.showEarned, dashboard.incomeMinor, false),
    netWorthCompact: metric(config.showNetWorth, dashboard.netWorthMinor, true),
    spentCompact: metric(config.showSpent, dashboard.expenseMinor, true),
    earnedCompact: metric(config.showEarned, dashboard.incomeMinor, true),
    primary: resolvePrimaryMetric(config),
  };
}

export const quickAddKind: WidgetKindDefinition<QuickAddWidgetConfig> = {
  kind: "quickAdd",
  defaults: {
    showNetWorth: true,
    showSpent: true,
    showEarned: true,
    primaryMetric: "netWorth",
  },
  normalize: (raw) => ({
    showNetWorth: flag(raw.showNetWorth, true),
    showSpent: flag(raw.showSpent, true),
    showEarned: flag(raw.showEarned, true),
    primaryMetric: oneOf(raw.primaryMetric, QUICK_ADD_METRICS, "netWorth"),
  }),
  build: (config, input, hideAmounts) => ({
    quickAdd: buildQuickAdd(config, input, hideAmounts),
  }),
};
