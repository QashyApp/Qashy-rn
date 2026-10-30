import type { FinanceContext } from "@/data/finance/context";
import { categoryMatcher } from "@/data/finance/queries";
import { postedBaseMinor } from "@/data/finance/rates";
import { active } from "@/data/finance/records";
import type {
  Budget,
  BudgetFilters,
  BudgetPeriodSnapshot,
  BudgetStatus,
  TransactionRecord,
} from "@/domain/models";
import { addRecurrence, todayLocal } from "@/utils/date";
import { budgetPeriodId } from "@/utils/deterministic-id";
import { createEntity, updateEntity } from "@/utils/entity";
import { addMinor, subtractMinor, sumMinor } from "@/utils/money";
import { resolvePeriod } from "@/utils/period";

// ---- Rollover and effective limit ------------------------------------------------------------

/** The rollover that counts toward the limit: stored amounts are inert while rollover is off. */
export function carriedRollover(
  budget: Budget,
  snapshot: BudgetPeriodSnapshot,
) {
  return budget.rollover ? snapshot.rolloverMinor : 0;
}

// A deficit compounds across every period it is carried through, so a few
// months of overspending can drive the rollover far enough negative that the
// effective limit turns permanently unreachable and the budget becomes
// useless. Cap the carried deficit at a single period's limit — one period of
// debt is a meaningful signal, ten is noise.
export function clampRollover(rolloverMinor: number, limitMinor: number) {
  const floor = -Math.abs(limitMinor);
  const ceiling = Number.MAX_SAFE_INTEGER - limitMinor;
  return Math.max(floor, Math.min(ceiling, rolloverMinor));
}

// A negative limit already exists as a consequence of overspending under rollover, so the
// rule cannot be "never below zero" — it is that a deliberate cut must not be what takes
// the limit there, or lowers it any further once it is already there.
export function assertLimitNotLowered(
  before: number,
  after: number,
  subject: string,
) {
  if (after < 0 && after < before)
    throw new Error(`${subject} would reduce the budget below zero.`);
}

export function effectiveLimitFor(
  ctx: FinanceContext,
  budget: Budget,
  snapshot: BudgetPeriodSnapshot,
) {
  return addMinor(
    addMinor(
      snapshot.limitMinor,
      carriedRollover(budget, snapshot),
      `${budget.name} effective limit`,
    ),
    budgetAdjustmentTotal(
      ctx,
      budget.id,
      snapshot.periodStart,
      snapshot.periodEnd,
    ),
    `${budget.name} effective limit`,
  );
}

export function budgetAdjustmentsInWindow(
  ctx: FinanceContext,
  budgetId: string,
  fromDate: string,
  toDate: string,
) {
  return active(ctx.state.budgetAdjustments).filter(
    (item) =>
      item.budgetId === budgetId &&
      item.date >= fromDate &&
      item.date <= toDate,
  );
}

export function budgetAdjustmentTotal(
  ctx: FinanceContext,
  budgetId: string,
  fromDate: string,
  toDate: string,
) {
  return sumMinor(
    budgetAdjustmentsInWindow(ctx, budgetId, fromDate, toDate).map(
      (item) => item.amountMinor,
    ),
    "Budget adjustment total",
  );
}

// ---- Period snapshots ------------------------------------------------------------------------

// The stored snapshot for the window containing `onDate`, or a transient one when the
// period rolled over while the app stayed open; the next generateRecurring run persists it.
export function currentSnapshot(
  ctx: FinanceContext,
  budget: Budget,
  onDate: string,
) {
  const bounds = resolvePeriod(budget.period, onDate);
  if (
    budget.period.unit === "custom" &&
    (onDate < bounds.start || onDate > bounds.end)
  )
    return undefined;
  return snapshotStartingAt(ctx, budget, bounds.start, onDate);
}

// Falls back to a transient snapshot when the period rolled over while the app stayed open;
// the next generateRecurring run persists it.
export function snapshotStartingAt(
  ctx: FinanceContext,
  budget: Budget,
  periodStart: string,
  onDate: string,
) {
  return (
    ctx.state.budgetPeriods.find(
      (item) => item.budgetId === budget.id && item.periodStart === periodStart,
    ) ??
    buildBudgetSnapshots(ctx, budget, false, onDate, true).find(
      (item) => item.periodStart === periodStart,
    )
  );
}

// A snapshot belongs to the budget's current period definition only if resolving
// that definition on the snapshot's own start date reproduces the same window.
// Snapshots do not store the definition they were built from, so this is how a
// stale one is recognised after the user edits unit, interval, or anchor date.
export function matchesPeriodDefinition(
  budget: Budget,
  snapshot: BudgetPeriodSnapshot,
) {
  const bounds = resolvePeriod(budget.period, snapshot.periodStart);
  return (
    bounds.start === snapshot.periodStart && bounds.end === snapshot.periodEnd
  );
}

export function buildBudgetSnapshots(
  ctx: FinanceContext,
  budget: Budget,
  updateCurrent: boolean,
  onDate = todayLocal(),
  transient = false,
  /**
   * Saving a budget with rollover newly on: the current period, if it carries nothing yet, takes
   * the carry the previous period would have handed it. Earlier periods are never rewritten.
   */
  carryIntoCurrent = false,
) {
  const bounds = resolvePeriod(budget.period, onDate);
  const existing = ctx.state.budgetPeriods.find(
    (item) => item.budgetId === budget.id && item.periodStart === bounds.start,
  );
  if (existing && !updateCurrent) return [];
  const history = ctx.state.budgetPeriods
    // `periodEnd`, not `periodStart`: a snapshot that merely *started* earlier can
    // still be running. Editing a budget's unit/interval/anchor moves `bounds.start`
    // off every stored snapshot, and the old selection then rolled over from a
    // window whose spend total was not final yet.
    .filter(
      (item) => item.budgetId === budget.id && item.periodEnd < bounds.start,
    )
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const candidate = history.at(-1);
  // Roll over only from a window the current definition would still produce.
  // Otherwise a budget switched from monthly to weekly inherits a whole month's
  // unspent limit into its first week.
  const latest =
    candidate && matchesPeriodDefinition(budget, candidate)
      ? candidate
      : undefined;
  // A one-time adjustment is part of what the period had to spend, so an unspent bonus
  // carries forward (and a deliberate cut is carried as a smaller remainder).
  const carryFrom = (previous: BudgetPeriodSnapshot) =>
    clampRollover(
      subtractMinor(
        addMinor(
          addMinor(
            previous.rolloverMinor,
            previous.limitMinor,
            `${budget.name} rollover`,
          ),
          budgetAdjustmentTotal(
            ctx,
            budget.id,
            previous.periodStart,
            previous.periodEnd,
          ),
          `${budget.name} rollover`,
        ),
        budgetSpend(
          ctx,
          previous.filters,
          previous.periodStart,
          previous.periodEnd,
        ),
        `${budget.name} rollover`,
      ),
      budget.limitMinor,
    );
  if (existing) {
    // A matching start alone is not enough: changing July monthly to a
    // July–August window finds the same snapshot, but its rollover belongs
    // to the old definition. Carrying it forward would grant (or charge) a
    // period that no longer exists, so only preserve it when the complete
    // resolved window still matches.
    const preservesDefinition = matchesPeriodDefinition(budget, existing);
    // Kept even while rollover is switched off: the effective limit ignores it then, so
    // switching it back on restores the same carried amount instead of silently zeroing it.
    const kept = preservesDefinition ? existing.rolloverMinor : 0;
    return [
      updateEntity(existing, {
        periodEnd: bounds.end,
        limitMinor: budget.limitMinor,
        // Rollover switched on partway through a period: the period began without a carry (it
        // was off then), so it takes what the previous period leaves, as if it had been on.
        rolloverMinor:
          carryIntoCurrent && budget.rollover && kept === 0 && latest
            ? carryFrom(latest)
            : kept,
        filters: budget.filters,
        categoryLimits: budget.categoryLimits,
      }),
    ];
  }
  const makePeriod = (
    periodStart: string,
    periodEnd: string,
    previous?: BudgetPeriodSnapshot,
  ) => {
    const values = {
      budgetId: budget.id,
      periodStart,
      periodEnd,
      limitMinor: budget.limitMinor,
      rolloverMinor: budget.rollover && previous ? carryFrom(previous) : 0,
      filters: budget.filters,
      categoryLimits: budget.categoryLimits,
    };
    // A period that has not rolled over yet is rebuilt on every read. Minting
    // a fresh UUID and timestamps each time made the snapshot identity churn
    // between two identical reads, so any list key or memo derived from it
    // changed on every render. Derive a stable identity instead.
    //
    // The persisted path uses the same derivation, for two reasons. Two devices
    // foregrounding on the first of a month would otherwise each mint a snapshot for the
    // same `(budgetId, periodStart)`; the history sort then ties, `.at(-1)` picks
    // arbitrarily, and rollover diverges between them — a wrong number on screen rather
    // than a crash. And sharing the derivation means a transient snapshot keeps its
    // identity when it is later persisted, instead of the list key changing underneath.
    const id = budgetPeriodId(budget.id, periodStart);
    if (!transient)
      return createEntity({ id, ...values }) as BudgetPeriodSnapshot;
    return {
      ...values,
      id,
      revision: 1,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
      deletedAt: null,
    } satisfies BudgetPeriodSnapshot;
  };
  if (!latest || updateCurrent || budget.period.unit === "custom") {
    return [makePeriod(bounds.start, bounds.end, latest)];
  }
  const periods: BudgetPeriodSnapshot[] = [];
  let previous = latest;
  let guard = 0;
  while (previous.periodStart < bounds.start && guard < 3660) {
    guard += 1;
    const nextBounds = resolvePeriod(
      budget.period,
      addRecurrence(previous.periodEnd, "day", 1),
    );
    if (
      nextBounds.start <= previous.periodStart ||
      nextBounds.start > bounds.start
    )
      break;
    const period = makePeriod(nextBounds.start, nextBounds.end, previous);
    periods.push(period);
    previous = period;
  }
  if (!periods.some((period) => period.periodStart === bounds.start)) {
    periods.push(makePeriod(bounds.start, bounds.end, previous));
  }
  return periods;
}

/** Periods that have opened and are not yet stored. Pure: the caller persists them. */
export function dueBudgetSnapshots(ctx: FinanceContext) {
  return active(ctx.state.budgets)
    .filter((item) => !item.archived)
    .flatMap((budget) => buildBudgetSnapshots(ctx, budget, false));
}

// ---- Spending and status ---------------------------------------------------------------------

/** The posted expenses a budget with these filters counts in the range, as the records themselves. */
export function budgetMatches(
  ctx: FinanceContext,
  filters: BudgetFilters,
  fromDate: string,
  toDate: string,
): TransactionRecord[] {
  const matchesCategory = filters.categoryIds.length
    ? categoryMatcher(ctx.state.categories, filters.categoryIds)
    : null;
  return ctx
    .postedTransactions(fromDate, toDate)
    .filter((item) => item.kind === "expense")
    .filter(
      (item) =>
        !filters.accountIds.length ||
        filters.accountIds.includes(item.accountId),
    )
    .filter((item) => !matchesCategory || matchesCategory(item.categoryId))
    .filter(
      (item) =>
        !filters.tagIds.length ||
        filters.tagIds.some((id) => item.tagIds.includes(id)),
    );
}

export function budgetSpend(
  ctx: FinanceContext,
  filters: BudgetFilters,
  fromDate: string,
  toDate: string,
) {
  return sumMinor(
    budgetMatches(ctx, filters, fromDate, toDate).map((item) =>
      postedBaseMinor(item),
    ),
    "Budget spending",
  );
}

export function computeBudgetStatuses(
  ctx: FinanceContext,
  onDate: string,
  options: { includeInactiveCustom?: boolean },
): BudgetStatus[] {
  return active(ctx.state.budgets)
    .filter((budget) => !budget.archived)
    .flatMap((budget) => {
      const bounds = resolvePeriod(budget.period, onDate);
      if (
        budget.period.unit === "custom" &&
        !options.includeInactiveCustom &&
        (onDate < bounds.start || onDate > bounds.end)
      )
        return [];
      const snapshot = snapshotStartingAt(ctx, budget, bounds.start, onDate);
      if (!snapshot) return [];
      const adjustments = budgetAdjustmentsInWindow(
        ctx,
        budget.id,
        snapshot.periodStart,
        snapshot.periodEnd,
      ).sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt),
      );
      const adjustmentMinor = sumMinor(
        adjustments.map((item) => item.amountMinor),
        "Budget adjustment total",
      );
      const spentMinor = budgetSpend(
        ctx,
        snapshot.filters,
        snapshot.periodStart,
        snapshot.periodEnd,
      );
      const categorySpend = snapshot.categoryLimits.map((limit) => ({
        ...limit,
        amountMinor: budgetSpend(
          ctx,
          { ...snapshot.filters, categoryIds: [limit.categoryId] },
          snapshot.periodStart,
          snapshot.periodEnd,
        ),
      }));
      return [
        {
          budget,
          snapshot,
          spentMinor,
          adjustmentMinor,
          adjustments,
          effectiveLimitMinor: addMinor(
            addMinor(
              snapshot.limitMinor,
              carriedRollover(budget, snapshot),
              `${budget.name} effective limit`,
            ),
            adjustmentMinor,
            `${budget.name} effective limit`,
          ),
          categorySpend,
        },
      ];
    });
}

export function assertBudgetSetSafe(budgets: Budget[]) {
  const maximumEffectiveLimits = active(budgets)
    .filter((budget) => !budget.archived)
    .map((budget) =>
      budget.rollover
        ? addMinor(
            budget.limitMinor,
            Math.min(
              budget.limitMinor,
              Number.MAX_SAFE_INTEGER - budget.limitMinor,
            ),
            `${budget.name} maximum effective limit`,
          )
        : budget.limitMinor,
    );
  sumMinor(maximumEffectiveLimits, "Budget limit total");
}
