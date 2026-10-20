import { MASKED_AMOUNT } from "@/features/widgets/kinds/shared";
import type { WidgetKindDefinition } from "@/features/widgets/kinds/types";
import type { WidgetAppearance } from "@/features/widgets/settings";
import type { SnapshotInput } from "@/features/widgets/snapshot";
import { monthLabel, startOfMonth } from "@/utils/date";
import { formatMoney } from "@/utils/money";

export interface QuickAddWidgetConfig extends WidgetAppearance {
  kind: "quickAdd";
  showNetWorth: boolean;
  showSpent: boolean;
  showEarned: boolean;
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
  const money = (minor: number) =>
    hideAmounts
      ? MASKED_AMOUNT
      : formatMoney(minor, source.baseCurrency, locale);
  // A metric that is switched off is `null`, and so is never computed into the snapshot.
  return {
    monthLabel: monthLabel(today, locale),
    netWorth: config.showNetWorth ? money(dashboard.netWorthMinor) : null,
    spent: config.showSpent ? money(dashboard.expenseMinor) : null,
    earned: config.showEarned ? money(dashboard.incomeMinor) : null,
  };
}

export const quickAddKind: WidgetKindDefinition<QuickAddWidgetConfig> = {
  kind: "quickAdd",
  defaults: { showNetWorth: true, showSpent: true, showEarned: true },
  normalize: (raw) => ({
    showNetWorth: flag(raw.showNetWorth, true),
    showSpent: flag(raw.showSpent, true),
    showEarned: flag(raw.showEarned, true),
  }),
  build: (config, input, hideAmounts) => ({
    quickAdd: buildQuickAdd(config, input, hideAmounts),
  }),
};
