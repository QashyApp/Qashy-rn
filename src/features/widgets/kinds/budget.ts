import type { BudgetStatus } from "@/domain/models";
import type { WidgetKindDefinition } from "@/features/widgets/kinds/types";
import type { WidgetAppearance } from "@/features/widgets/settings";
import type {
  SnapshotInput,
  WidgetSnapshotEntry,
} from "@/features/widgets/snapshot";
import { monthLabel, shortDate } from "@/utils/date";
import { formatMoney } from "@/utils/money";
import { budgetPace, type BudgetPaceStatus } from "@/utils/pace";

export interface BudgetWidgetConfig extends WidgetAppearance {
  kind: "budget";
  /** `null` means the first active budget. */
  budgetId: string | null;
}

/** The Plan screen's wording for each pace status. */
const PACE_TEXT: Record<BudgetPaceStatus, string> = {
  under: "Under pace",
  onTrack: "On track",
  projectedOver: "Over pace",
  over: "Over budget",
};

/** A percentage beyond this is drawn as this; the figure is only ever a glance. */
const MAX_PERCENT = 999;

type BudgetStatusView = Pick<
  BudgetStatus,
  "budget" | "snapshot" | "spentMinor" | "effectiveLimitMinor"
>;

/**
 * The budget a widget shows: the configured one while it is still active (deleted, or a custom
 * budget outside its window, is not), else the first active budget, in the Plan screen's order.
 */
export function pickBudgetStatus<T extends BudgetStatusView>(
  active: readonly T[],
  budgetId: string | null,
): T | undefined {
  return (
    (budgetId
      ? active.find((status) => status.budget.id === budgetId)
      : undefined) ?? active[0]
  );
}

function periodLabel(
  status: BudgetStatusView,
  { locale }: Pick<SnapshotInput, "locale">,
): string {
  const { budget, snapshot } = status;
  const { periodStart, periodEnd } = snapshot;
  return budget.period.unit === "month" && budget.period.interval === 1
    ? monthLabel(periodStart, locale)
    : `${shortDate(periodStart, locale)} – ${shortDate(periodEnd, locale)}`;
}

function buildBudget(
  config: BudgetWidgetConfig,
  input: SnapshotInput,
  hideAmounts: boolean,
): NonNullable<WidgetSnapshotEntry["budget"]> {
  const { source, t, locale, today } = input;
  const status = pickBudgetStatus(
    source.getBudgetStatuses(today),
    config.budgetId,
  );
  if (!status) {
    return {
      empty: true,
      name: t("Create a budget"),
      period: "",
      percent: 0,
      progress: 0,
      elapsed: 0,
      over: false,
      status: "onTrack",
      statusText: "",
      spent: null,
      limit: null,
      remaining: null,
      spentCompact: null,
      limitCompact: null,
      remainingCompact: null,
    };
  }
  const { budget, snapshot, spentMinor, effectiveLimitMinor } = status;
  const pace = budgetPace({
    spentMinor,
    limitMinor: effectiveLimitMinor,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    today,
  });
  const money = (minor: number, compact = false) =>
    formatMoney(minor, source.baseCurrency, locale, { compact });
  const difference = effectiveLimitMinor - spentMinor;
  const remainingText = (compact: boolean) =>
    difference >= 0
      ? `${money(difference, compact)} ${t("left")}`
      : `${money(-difference, compact)} ${t("over")}`;
  // Percentages and the pace wording are not amounts; every figure of money is.
  return {
    empty: false,
    name: budget.name,
    period: periodLabel(status, input),
    percent: Math.min(
      MAX_PERCENT,
      Math.max(0, Math.round(pace.spentRatio * 100)),
    ),
    progress: Math.min(1, Math.max(0, pace.spentRatio)),
    elapsed: pace.elapsedRatio,
    over: pace.status === "over",
    status: pace.status,
    statusText: t(PACE_TEXT[pace.status]),
    spent: hideAmounts ? null : money(spentMinor),
    limit: hideAmounts ? null : money(effectiveLimitMinor),
    remaining: hideAmounts ? null : remainingText(false),
    spentCompact: hideAmounts ? null : money(spentMinor, true),
    limitCompact: hideAmounts ? null : money(effectiveLimitMinor, true),
    remainingCompact: hideAmounts ? null : remainingText(true),
  };
}

export const budgetKind: WidgetKindDefinition<BudgetWidgetConfig> = {
  kind: "budget",
  defaults: { budgetId: null },
  normalize: (raw) => ({
    budgetId:
      typeof raw.budgetId === "string" && raw.budgetId.length > 0
        ? raw.budgetId
        : null,
  }),
  build: (config, input, hideAmounts) => ({
    budget: buildBudget(config, input, hideAmounts),
  }),
};
