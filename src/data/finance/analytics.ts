import type { FinanceContext } from "@/data/finance/context";
import { budgetMatches } from "@/data/finance/budgets";
import { queryTransactions, categoryMatcher } from "@/data/finance/queries";
import {
  MissingExchangeRateError,
  postedBaseMinor,
  resolveRate,
} from "@/data/finance/rates";
import { active } from "@/data/finance/records";
import { assertDate } from "@/data/finance/validation";
import type {
  Account,
  BudgetStatus,
  DashboardSummary,
  Goal,
  GoalContribution,
  TransactionRecord,
} from "@/domain/models";
import type { NetWorthSeries } from "@/data/repository";
import {
  addRecurrence,
  endOfMonth,
  moveMonth,
  parseLocalDate,
  startOfMonth,
  todayLocal,
  toLocalDate,
} from "@/utils/date";
import { addMinor, convertMinor, subtractMinor, sumMinor } from "@/utils/money";

// Roughly a century of daily points. A wider dashboard range is rejected. Why: it would
// truncate the daily series silently and return a chart that was simply wrong.
const MAX_DASHBOARD_DAYS = 36_600;
const MAX_NET_WORTH_MONTHS = 24;

// Inclusive whole-day count. Compared through UTC midnights so a daylight
// saving transition inside the range cannot shift the total by a day.
function daySpan(fromDate: string, toDate: string) {
  const from = parseLocalDate(fromDate);
  const to = parseLocalDate(toDate);
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / 86_400_000) + 1;
}

/** Rejects a dashboard range that is not real dates, runs backwards or spans more than a century. */
export function assertDashboardRange(fromDate: string, toDate: string) {
  assertDate(fromDate);
  assertDate(toDate);
  if (fromDate > toDate)
    throw new Error("Dashboard start date must not be after its end date.");
  if (daySpan(fromDate, toDate) > MAX_DASHBOARD_DAYS) {
    throw new Error("Choose a dashboard range no longer than a century.");
  }
}

/** Rejects a net-worth history that is not a whole number of months within the supported window. */
export function assertNetWorthMonths(months: number) {
  if (
    !Number.isInteger(months) ||
    months < 1 ||
    months > MAX_NET_WORTH_MONTHS
  ) {
    throw new Error(
      `Choose a whole number of months from 1 to ${MAX_NET_WORTH_MONTHS}.`,
    );
  }
}

/**
 * The dashboard for a date range, computed from the posted transactions in it. `getBudgetStatuses`
 * is the repository's own (cached) read, so the budget figures match what the Plan screen shows.
 */
export function computeDashboard(
  ctx: FinanceContext,
  fromDate: string,
  toDate: string,
  getBudgetStatuses: (
    onDate: string,
    options: { includeInactiveCustom?: boolean },
  ) => BudgetStatus[],
): DashboardSummary {
  const posted = ctx.postedTransactions(fromDate, toDate);
  const allPosted = ctx.postedTransactions();
  const accountBalances = computeAccountBalances(ctx, allPosted);
  const {
    incomeMinor,
    expenseMinor,
    categorySpend,
    dayTotals,
    recentTransactions,
  } = tallyRange(ctx, posted);
  const { budgetLimitMinor, budgetSpentMinor } = budgetTotals(
    ctx,
    fromDate,
    toDate,
    getBudgetStatuses,
  );
  const dailySpend = dailySpendSeries(fromDate, toDate, dayTotals);
  const { netWorthMinor, missingExchangeRates } = netWorthOf(
    ctx,
    accountBalances,
  );
  return {
    netWorthMinor,
    incomeMinor,
    expenseMinor,
    netFlowMinor: subtractMinor(incomeMinor, expenseMinor, "Net flow"),
    budgetLimitMinor,
    budgetSpentMinor,
    accountBalances,
    categorySpend,
    recentTransactions,
    upcomingTransactions: queryTransactions(ctx, {
      statuses: ["upcoming"],
      sort: "oldest",
      limit: 5,
    }),
    dailySpend,
    missingExchangeRates,
  };
}

/** Every active account with its balance now: the opening balance plus its posted transactions. */
function computeAccountBalances(
  ctx: FinanceContext,
  allPosted: TransactionRecord[],
) {
  const accounts = active(ctx.state.accounts);
  // One pass over every posted transaction keeps balances O(n + accounts)
  // instead of O(accounts × n); a running total does not need the sort.
  const balances = new Map(
    accounts.map((account) => [account.id, account.openingBalanceMinor]),
  );
  for (const transaction of allPosted) {
    if (transaction.kind === "expense" || transaction.kind === "transfer") {
      const current = balances.get(transaction.accountId);
      if (current !== undefined)
        balances.set(
          transaction.accountId,
          subtractMinor(current, transaction.amountMinor, "Account balance"),
        );
    }
    if (transaction.kind === "income") {
      const current = balances.get(transaction.accountId);
      if (current !== undefined)
        balances.set(
          transaction.accountId,
          addMinor(current, transaction.amountMinor, "Account balance"),
        );
    }
    if (transaction.kind === "transfer" && transaction.destinationAccountId) {
      const current = balances.get(transaction.destinationAccountId);
      if (current !== undefined)
        balances.set(
          transaction.destinationAccountId,
          addMinor(
            current,
            transaction.destinationAmountMinor ?? 0,
            "Account balance",
          ),
        );
    }
  }
  const accountBalances = accounts
    .map((account) => ({
      account,
      balanceMinor: balances.get(account.id) ?? account.openingBalanceMinor,
    }))
    // Nothing is archived any more; an account an older build archived is swept at startup, and
    // until then its balance stays out of net worth.
    .filter(({ account }) => !account.archived);
  return accountBalances;
}

/**
 * One pass over the range for income, expense, category, uncategorized, and daily totals,
 * tracking the 5 newest rows for the recent list.
 */
function tallyRange(ctx: FinanceContext, posted: TransactionRecord[]) {
  const expenseCategories = active(ctx.state.categories).filter(
    (category) => category.kind === "expense",
  );
  const expenseCategoryIds = new Set(
    expenseCategories.map((category) => category.id),
  );
  // One pass over the range for income, expense, category, uncategorized, and
  // daily totals, tracking the 5 newest rows for recentTransactions so the
  // whole range never needs sorting.
  let incomeMinor = 0;
  let expenseMinor = 0;
  const categoryTotals = new Map<string, number>();
  const dayTotals = new Map<string, number>();
  const recentTransactions: TransactionRecord[] = [];
  let uncategorizedMinor = 0;
  for (const item of posted) {
    if (item.kind === "income") {
      incomeMinor = addMinor(
        incomeMinor,
        postedBaseMinor(item),
        "Income total",
      );
    } else if (item.kind === "expense") {
      const baseMinor = postedBaseMinor(item);
      expenseMinor = addMinor(expenseMinor, baseMinor, "Expense total");
      dayTotals.set(
        item.localDate,
        addMinor(
          dayTotals.get(item.localDate) ?? 0,
          baseMinor,
          "Daily spending",
        ),
      );
      if (item.categoryId && expenseCategoryIds.has(item.categoryId)) {
        categoryTotals.set(
          item.categoryId,
          addMinor(
            categoryTotals.get(item.categoryId) ?? 0,
            baseMinor,
            "Category spending",
          ),
        );
      } else {
        uncategorizedMinor = addMinor(
          uncategorizedMinor,
          baseMinor,
          "Uncategorized spending",
        );
      }
    }
    const insertAt = recentTransactions.findIndex(
      (existing) =>
        item.localDate > existing.localDate ||
        (item.localDate === existing.localDate &&
          item.createdAt > existing.createdAt),
    );
    if (insertAt === -1) {
      if (recentTransactions.length < 5) recentTransactions.push(item);
    } else {
      recentTransactions.splice(insertAt, 0, item);
      if (recentTransactions.length > 5) recentTransactions.pop();
    }
  }
  const categorySpend: DashboardSummary["categorySpend"] = expenseCategories
    .map((category) => ({
      category,
      amountMinor: categoryTotals.get(category.id) ?? 0,
    }))
    .filter((item) => item.amountMinor > 0);
  if (uncategorizedMinor > 0) {
    categorySpend.push({ category: null, amountMinor: uncategorizedMinor });
  }
  categorySpend.sort((a, b) => b.amountMinor - a.amountMinor);
  return {
    incomeMinor,
    expenseMinor,
    categorySpend,
    dayTotals,
    recentTransactions,
  };
}

/**
 * The limit and spending of the budgets that overlap the range.
 *
 * Spending counts each transaction once however many budgets match it: it is the union of the
 * transactions each budget counts in its own current period, so one coffee in "Food" and in
 * "Everything" is one coffee. Limits are summed, except that a budget whose period lies inside the
 * period of an all-spending budget (no account, category or tag filter) adds no limit of its own:
 * everything it counts is already counted by that bigger budget, so its limit would otherwise be
 * allowed on top of money that is already allowed. Partially overlapping budgets (two category
 * budgets sharing a tag, say) are still summed; that is the plain total of what the user allowed.
 */
function budgetTotals(
  ctx: FinanceContext,
  fromDate: string,
  toDate: string,
  getBudgetStatuses: (
    onDate: string,
    options: { includeInactiveCustom?: boolean },
  ) => BudgetStatus[],
) {
  const today = todayLocal();
  const budgetDate = today >= fromDate && today <= toDate ? today : toDate;
  const budgetEntries = getBudgetStatuses(budgetDate, {
    includeInactiveCustom: true,
  }).filter(
    ({ budget, snapshot }) =>
      budget.period.unit !== "custom" ||
      (snapshot.periodStart <= toDate && snapshot.periodEnd >= fromDate),
  );
  const isAllSpending = ({ snapshot }: BudgetStatus) =>
    !snapshot.filters.accountIds.length &&
    !snapshot.filters.categoryIds.length &&
    !snapshot.filters.tagIds.length;
  // `outer` swallows `inner` when it counts all spending over a period that contains inner's.
  // Two identical all-spending budgets would swallow each other, so the earlier one wins.
  const swallows = (outer: BudgetStatus, inner: BudgetStatus) =>
    outer !== inner &&
    isAllSpending(outer) &&
    outer.snapshot.periodStart <= inner.snapshot.periodStart &&
    outer.snapshot.periodEnd >= inner.snapshot.periodEnd &&
    (!isAllSpending(inner) ||
      outer.snapshot.periodStart !== inner.snapshot.periodStart ||
      outer.snapshot.periodEnd !== inner.snapshot.periodEnd ||
      budgetEntries.indexOf(outer) < budgetEntries.indexOf(inner));
  const budgetLimitMinor = sumMinor(
    budgetEntries
      .filter(
        (entry) => !budgetEntries.some((other) => swallows(other, entry)),
      )
      .map((entry) => entry.effectiveLimitMinor),
    "Budget limit total",
  );
  const counted = new Map<string, number>();
  for (const { snapshot } of budgetEntries) {
    for (const item of budgetMatches(
      ctx,
      snapshot.filters,
      snapshot.periodStart,
      snapshot.periodEnd,
    )) {
      counted.set(item.id, postedBaseMinor(item));
    }
  }
  const budgetSpentMinor = sumMinor(counted.values(), "Budget spending total");
  return { budgetLimitMinor, budgetSpentMinor };
}

/** One point per day of the range, zero where nothing was spent. */
function dailySpendSeries(
  fromDate: string,
  toDate: string,
  dayTotals: Map<string, number>,
) {
  const dailySpend: DashboardSummary["dailySpend"] = [];
  let spendDate = fromDate;
  let spendGuard = 0;
  while (spendDate <= toDate && spendGuard < MAX_DASHBOARD_DAYS) {
    dailySpend.push({
      date: spendDate,
      amountMinor: dayTotals.get(spendDate) ?? 0,
    });
    spendDate = addRecurrence(spendDate, "day", 1);
    spendGuard += 1;
  }
  return dailySpend;
}

/** Net worth in the base currency, and the currencies it could not convert for want of a rate. */
function netWorthOf(
  ctx: FinanceContext,
  accountBalances: { account: Account; balanceMinor: number }[],
) {
  let netWorthMinor = 0;
  const missingExchangeRates: DashboardSummary["missingExchangeRates"] = [];
  const balanceDate = todayLocal();
  for (const item of accountBalances) {
    let rate: string;
    try {
      rate = resolveRate(
        ctx,
        item.account.currency,
        ctx.state.settings.baseCurrency,
        balanceDate,
      );
    } catch (reason) {
      if (!(reason instanceof MissingExchangeRateError)) throw reason;
      if (
        !missingExchangeRates.some(
          (rate) => rate.fromCurrency === item.account.currency,
        )
      ) {
        missingExchangeRates.push({
          fromCurrency: item.account.currency,
          toCurrency: ctx.state.settings.baseCurrency,
        });
      }
      continue;
    }
    netWorthMinor = addMinor(
      netWorthMinor,
      convertMinor(
        item.balanceMinor,
        item.account.currency,
        ctx.state.settings.baseCurrency,
        rate,
        ctx.formatLocale,
      ),
      "Net worth",
    );
  }
  return { netWorthMinor, missingExchangeRates };
}

/**
 * Month-end net worth for the last `months` months plus today. The last point is the
 * dashboard's own headline, so the chart ends on the number shown above it.
 */
export function computeNetWorthSeries(
  ctx: FinanceContext,
  months: number,
  today: string,
  getDashboard: (fromDate: string, toDate: string) => DashboardSummary,
): NetWorthSeries {
  const base = ctx.state.settings.baseCurrency;
  const missingExchangeRates: NetWorthSeries["missingExchangeRates"] = [];
  // Values never saved in the base currency convert at today's rate, as the headline does.
  const convertAtToday = (amountMinor: number, currency: string): number => {
    if (currency === base) return amountMinor;
    let rate: string;
    try {
      rate = resolveRate(ctx, currency, base, today);
    } catch (reason) {
      if (!(reason instanceof MissingExchangeRateError)) throw reason;
      if (
        !missingExchangeRates.some((item) => item.fromCurrency === currency)
      ) {
        missingExchangeRates.push({
          fromCurrency: currency,
          toCurrency: base,
        });
      }
      return 0;
    }
    return convertMinor(amountMinor, currency, base, rate, ctx.formatLocale);
  };

  const includedAccounts = active(ctx.state.accounts).filter(
    (account) => !account.archived,
  );
  const included = new Map(includedAccounts.map((a) => [a.id, a]));
  const everyAccount = new Map(ctx.state.accounts.map((a) => [a.id, a]));

  let openingMinor = 0;
  for (const account of includedAccounts) {
    openingMinor = addMinor(
      openingMinor,
      convertAtToday(account.openingBalanceMinor, account.currency),
      "Net worth",
    );
  }
  const effects = netWorthEffects(ctx, included, everyAccount, convertAtToday);

  const dates: string[] = [];
  for (let back = months; back >= 1; back -= 1) {
    dates.push(endOfMonth(moveMonth(today, -back)));
  }
  dates.push(today);

  const points: NetWorthSeries["points"] = [];
  let runningMinor = openingMinor;
  let cursor = 0;
  for (const date of dates) {
    while (cursor < effects.length && effects[cursor].date <= date) {
      runningMinor = addMinor(
        runningMinor,
        effects[cursor].deltaMinor,
        "Net worth",
      );
      cursor += 1;
    }
    points.push({ date, baseMinor: runningMinor });
  }

  // The chart must end on the headline number, so the last point is the dashboard's own value.
  const headline = getDashboard(startOfMonth(today), today);
  points[points.length - 1] = {
    date: today,
    baseMinor: headline.netWorthMinor,
  };
  for (const missing of headline.missingExchangeRates) {
    if (
      !missingExchangeRates.some(
        (item) => item.fromCurrency === missing.fromCurrency,
      )
    ) {
      missingExchangeRates.push(missing);
    }
  }

  const series: NetWorthSeries = {
    baseCurrency: base,
    points,
    missingExchangeRates,
  };
  return series;
}

/** One signed base-currency effect per account leg, oldest first, so each point is a running total. */
function netWorthEffects(
  ctx: FinanceContext,
  included: Map<string, Account>,
  everyAccount: Map<string, Account>,
  convertAtToday: (amountMinor: number, currency: string) => number,
) {
  const effects: { date: string; deltaMinor: number }[] = [];
  for (const item of ctx.postedTransactions()) {
    const source = included.get(item.accountId);
    if (item.kind === "expense" || item.kind === "income") {
      if (!source) continue;
      const valueMinor =
        item.baseAmountMinor ?? convertAtToday(item.amountMinor, item.currency);
      effects.push({
        date: item.localDate,
        deltaMinor: item.kind === "expense" ? -valueMinor : valueMinor,
      });
      continue;
    }
    if (item.kind !== "transfer") continue;
    const destination = item.destinationAccountId
      ? included.get(item.destinationAccountId)
      : undefined;
    const sourceCurrency = (source ?? everyAccount.get(item.accountId))
      ?.currency;
    const destinationCurrency = item.destinationAccountId
      ? everyAccount.get(item.destinationAccountId)?.currency
      : undefined;
    const sameCurrency =
      sourceCurrency !== undefined && sourceCurrency === destinationCurrency;
    if (source) {
      const outMinor =
        sameCurrency && item.baseAmountMinor !== null
          ? item.baseAmountMinor
          : convertAtToday(item.amountMinor, source.currency);
      effects.push({ date: item.localDate, deltaMinor: -outMinor });
    }
    if (destination) {
      const inMinor =
        sameCurrency && item.destinationBaseAmountMinor !== null
          ? item.destinationBaseAmountMinor
          : convertAtToday(
              item.destinationAmountMinor ?? 0,
              destination.currency,
            );
      effects.push({ date: item.localDate, deltaMinor: inMinor });
    }
  }
  effects.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return effects;
}

// The base value credited by a transfer's destination leg. baseAmountMinor
// snapshots the source leg, which diverges from the destination whenever the
// manual destination amount disagrees with the source-leg conversion.
export function transferInflowBaseMinor(item: TransactionRecord) {
  return item.destinationBaseAmountMinor ?? postedBaseMinor(item);
}

export function calculateGoalProgress(
  ctx: FinanceContext,
  goalId: string,
  goals: Goal[],
  contributions: GoalContribution[],
  transactions: TransactionRecord[],
) {
  const goal = goals.find((item) => item.id === goalId);
  if (!goal) throw new Error("Choose a valid goal.");
  const progressLabel = `${goal.name} progress`;
  const transactionsById = ctx.transactionById(transactions);
  const manual = sumMinor(
    contributions
      .filter((item) => {
        if (item.goalId !== goal.id || item.deletedAt) return false;
        if (!item.transactionId) return true;
        const transaction = transactionsById.get(item.transactionId);
        return Boolean(
          transaction &&
          !transaction.deletedAt &&
          transaction.status === "posted",
        );
      })
      .map((item) => item.amountMinor),
    `${goal.name} contributions`,
  );
  if (!goal.linkedAccountId && !goal.linkedCategoryId) {
    return addMinor(goal.initialMinor, manual, progressLabel);
  }
  let linked = 0;
  // Linked progress only counts activity from the goal's creation date onward.
  const goalStart = toLocalDate(new Date(goal.createdAt));
  const matchesCategory = goal.linkedCategoryId
    ? categoryMatcher(ctx.state.categories, [goal.linkedCategoryId])
    : null;
  for (const item of transactions) {
    if (item.deletedAt || item.status !== "posted") continue;
    if (item.localDate < goalStart) continue;
    if (matchesCategory && !matchesCategory(item.categoryId)) continue;
    // A spending goal counts expenses; a saving goal tied to a category counts income there.
    const countedKind =
      goal.kind === "spending"
        ? "expense"
        : goal.linkedCategoryId
          ? "income"
          : null;
    if (countedKind) {
      if (item.kind !== countedKind) continue;
      if (goal.linkedAccountId && item.accountId !== goal.linkedAccountId)
        continue;
      linked = addMinor(linked, postedBaseMinor(item), progressLabel);
      continue;
    }
    if (!goal.linkedAccountId) continue;
    if (item.kind === "income" && item.accountId === goal.linkedAccountId) {
      linked = addMinor(linked, postedBaseMinor(item), progressLabel);
    } else if (
      (item.kind === "expense" || item.kind === "transfer") &&
      item.accountId === goal.linkedAccountId
    ) {
      linked = subtractMinor(linked, postedBaseMinor(item), progressLabel);
    } else if (
      item.kind === "transfer" &&
      item.destinationAccountId === goal.linkedAccountId
    ) {
      linked = addMinor(linked, transferInflowBaseMinor(item), progressLabel);
    }
  }
  return addMinor(
    addMinor(goal.initialMinor, manual, progressLabel),
    linked,
    progressLabel,
  );
}

export function assertGoalProgressSafe(
  ctx: FinanceContext,
  goalId: string,
  goals: Goal[],
  contributions: GoalContribution[],
  transactions = ctx.state.transactions,
) {
  calculateGoalProgress(ctx, goalId, goals, contributions, transactions);
}
