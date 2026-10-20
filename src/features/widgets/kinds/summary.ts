import { oneOf, MASKED_AMOUNT } from "@/features/widgets/kinds/shared";
import type { WidgetKindDefinition } from "@/features/widgets/kinds/types";
import type { WidgetAppearance } from "@/features/widgets/settings";
import type { SnapshotInput } from "@/features/widgets/snapshot";
import {
  dateFormat,
  monthLabel,
  parseLocalDate,
  startOfMonth,
} from "@/utils/date";
import { formatMoney } from "@/utils/money";

export type GraphMonths = 3 | 6 | 12;
export const GRAPH_MONTHS: readonly GraphMonths[] = [3, 6, 12];

export interface SummaryWidgetConfig extends WidgetAppearance {
  kind: "summary";
  graphMonths: GraphMonths;
}

function buildSummary(
  config: SummaryWidgetConfig,
  input: SnapshotInput,
  hideAmounts: boolean,
) {
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

export const summaryKind: WidgetKindDefinition<SummaryWidgetConfig> = {
  kind: "summary",
  defaults: { graphMonths: 12 },
  normalize: (raw) => ({
    graphMonths: oneOf(raw.graphMonths, GRAPH_MONTHS, 12),
  }),
  build: (config, input, hideAmounts) => ({
    summary: buildSummary(config, input, hideAmounts),
  }),
};
