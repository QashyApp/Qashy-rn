import type { FinanceContext } from "@/data/finance/context";
import {
  applyTransactionChanges,
  asRecords,
  replaceById,
  tombstone,
} from "@/data/finance/records";
import { assertTransactionSetSafe } from "@/data/finance/safety";
import { convertTransferToPlain } from "@/data/finance/transactions";
import type { StoredEntity } from "@/data/storage-adapter";
import type {
  Budget,
  BudgetAdjustment,
  BudgetPeriodSnapshot,
  Category,
  EntityType,
  FinanceEntity,
  FinanceState,
  Goal,
  GoalContribution,
  RecurringRule,
  TransactionRecord,
} from "@/domain/models";
import { canActivateRecurringRule } from "@/domain/rules";
import {
  planAccountDeletion,
  type AccountDeletionPlan,
} from "@/utils/account-impact";
import { todayLocal } from "@/utils/date";
import { updateEntity } from "@/utils/entity";
import { resolvePeriod } from "@/utils/period";

/** The entity lists a delete can target (the snapshot's `ready` flag and settings row cannot be deleted). */
export type DeletableType = Exclude<keyof FinanceState, "ready" | "settings">;

/**
 * `options.sweep` is the one-time cleanup of data archived before archiving was removed. It
 * skips the last-account guard (the sweep keeps one account itself) and never lets a paused
 * schedule resume: a schedule whose category is deleted stays paused.
 */
export interface DeletionOptions {
  sweep?: boolean;
}

/**
 * Everything one delete writes: the tombstones for the entities themselves and every dependent
 * row that is deleted, detached or rewritten along with them.
 */
export interface DeletionPlan {
  type: DeletableType;
  deletedIds: Set<string>;
  deleted: FinanceEntity[];
  ruleChanges: RecurringRule[];
  deletedRules: RecurringRule[];
  contributions: GoalContribution[];
  orphanedContributions: GoalContribution[];
  budgetPeriods: BudgetPeriodSnapshot[];
  budgetAdjustments: BudgetAdjustment[];
  transactionChanges: TransactionRecord[];
  discardedUpcoming: TransactionRecord[];
  detachedCategories: Category[];
  budgetChanges: Budget[];
  budgetPeriodChanges: BudgetPeriodSnapshot[];
  goalChanges: Goal[];
  /** A rule came back off dependency-pause, so the caller must run a recurring catch-up. */
  reactivatedRule: boolean;
}

// ---- Planning ---------------------------------------------------------------------------------

/**
 * Works out, without writing anything, what deleting `ids` of `type` changes, and checks that the
 * balances and totals that remain are still representable. Throws before any write if not.
 */
export function planEntityDeletion(
  ctx: FinanceContext,
  type: DeletableType,
  ids: string[],
  options: DeletionOptions = {},
): DeletionPlan {
  const list = ctx.state[type] as FinanceEntity[];
  const deletedIds = new Set(ids);
  let accountPlan: AccountDeletionPlan | null = null;

  if (type === "accounts") {
    const wasLive = ctx.state.accounts.some(
      (account) => !account.archived && deletedIds.has(account.id),
    );
    const remaining = ctx.state.accounts.filter(
      (account) => !account.archived && !deletedIds.has(account.id),
    );
    if (wasLive && !remaining.length && !options.sweep)
      throw new Error(
        "Keep at least one account. Add another account before deleting this one.",
      );
    // Deleting an account deletes what was booked on it; a transfer whose other side survives
    // is kept there as income or expense. `planAccountDeletion` is the rule, and it is the same
    // plan the confirmation dialog describes.
    accountPlan = planAccountDeletion(ctx.state, [...deletedIds]);
  }
  const deleted = list
    .filter((entity) => deletedIds.has(entity.id))
    .map(tombstone);

  const ruleChanges = ruleChangesFor(ctx, type, deletedIds, options);

  const reactivatedRule = ruleChanges.some(
    (rule) =>
      rule.active &&
      ctx.state.recurringRules.some(
        (item) => item.id === rule.id && !item.active,
      ),
  );
  const contributions =
    type === "goals"
      ? ctx.state.contributions
          .filter((item) => deletedIds.has(item.goalId))
          .map(tombstone)
      : [];
  const budgetPeriods =
    type === "budgets"
      ? ctx.state.budgetPeriods
          .filter((item) => deletedIds.has(item.budgetId))
          .map(tombstone)
      : [];
  const budgetAdjustments =
    type === "budgets"
      ? ctx.state.budgetAdjustments
          .filter((item) => deletedIds.has(item.budgetId))
          .map(tombstone)
      : [];
  // A manual contribution that came from a transaction goes with it.
  const removedTransactionIds =
    type === "transactions"
      ? deletedIds
      : new Set(accountPlan?.deletedTransactions.map((item) => item.id));
  const orphanedContributions = removedTransactionIds.size
    ? ctx.state.contributions
        .filter(
          (item) =>
            !item.deletedAt &&
            item.transactionId !== null &&
            removedTransactionIds.has(item.transactionId),
        )
        .map(tombstone)
    : [];
  // Unconfirmed occurrences exist only because the rule does, so they go with it. Posted and
  // skipped ones are history and stay, detached from the rule.
  const ruleOccurrences =
    type === "recurringRules"
      ? ctx.state.transactions.filter(
          (item) =>
            !item.deletedAt &&
            item.recurringRuleId !== null &&
            deletedIds.has(item.recurringRuleId),
        )
      : [];
  // Deleting an account removes what was booked on it along with the schedules that post to
  // it, converts the transfers whose other side survives, and unlinks goals and budgets.
  const discardedUpcoming = accountPlan
    ? accountPlan.deletedTransactions.map(tombstone)
    : ruleOccurrences
        .filter((item) => item.status === "upcoming")
        .map(tombstone);
  const releasedTransactions = accountPlan
    ? accountPlan.releasedTransactions.map((item) =>
        updateEntity(item, { recurringRuleId: null }),
      )
    : ruleOccurrences
        .filter((item) => item.status !== "upcoming")
        .map((item) => updateEntity(item, { recurringRuleId: null }));
  const accountRuleIds = new Set(accountPlan?.rules.map((rule) => rule.id));
  const convertedTransactions = accountPlan
    ? accountPlan.conversions.map((conversion) =>
        convertTransferToPlain(ctx, conversion, accountRuleIds),
      )
    : [];
  const deletedRules = accountPlan ? accountPlan.rules.map(tombstone) : [];
  const untaggedTransactions =
    type === "tags"
      ? ctx.state.transactions
          .filter(
            (item) =>
              !item.deletedAt &&
              item.tagIds.some((tagId) => deletedIds.has(tagId)),
          )
          .map((item) =>
            updateEntity(item, {
              tagIds: item.tagIds.filter((tagId) => !deletedIds.has(tagId)),
            }),
          )
      : [];
  const uncategorisedTransactions =
    type === "categories"
      ? ctx.state.transactions
          .filter(
            (item) =>
              !item.deletedAt &&
              item.categoryId !== null &&
              deletedIds.has(item.categoryId),
          )
          .map((item) => updateEntity(item, { categoryId: null }))
      : [];
  const detachedCategories =
    type === "categories"
      ? ctx.state.categories
          .filter(
            (item) =>
              item.parentId !== null &&
              deletedIds.has(item.parentId) &&
              !deletedIds.has(item.id),
          )
          .map((item) => updateEntity(item, { parentId: null }))
      : [];
  const { budgetChanges, budgetPeriodChanges } = budgetChangesFor(
    ctx,
    type,
    deletedIds,
  );

  const goalChanges =
    type === "categories"
      ? ctx.state.goals
          .filter(
            (goal) =>
              goal.linkedCategoryId !== null &&
              deletedIds.has(goal.linkedCategoryId),
          )
          .map((goal) => updateEntity(goal, { linkedCategoryId: null }))
      : accountPlan
        ? accountPlan.goals.map((goal) =>
            updateEntity(goal, { linkedAccountId: null }),
          )
        : [];
  const transactionChanges = [
    ...releasedTransactions,
    ...untaggedTransactions,
    ...uncategorisedTransactions,
    ...convertedTransactions,
  ];
  if (type === "transactions") {
    assertTransactionSetSafe(
      ctx,
      ctx.state.transactions.filter((item) => !deletedIds.has(item.id)),
    );
  }
  if (accountPlan) {
    // The balances and totals that remain once the accounts, their transactions and the
    // converted transfers are applied must still be representable.
    assertTransactionSetSafe(
      ctx,
      applyTransactionChanges(ctx.state.transactions, [
        ...discardedUpcoming,
        ...transactionChanges,
      ]),
      ctx.state.accounts.filter((account) => !deletedIds.has(account.id)),
    );
  }
  return {
    type,
    deletedIds,
    deleted,
    ruleChanges,
    deletedRules,
    contributions,
    orphanedContributions,
    budgetPeriods,
    budgetAdjustments,
    transactionChanges,
    discardedUpcoming,
    detachedCategories,
    budgetChanges,
    budgetPeriodChanges,
    goalChanges,
    reactivatedRule,
  };
}

/** The recurring rules a delete rewrites: a deleted category or tag is dropped from their template. */
function ruleChangesFor(
  ctx: FinanceContext,
  type: DeletableType,
  deletedIds: Set<string>,
  options: DeletionOptions,
) {
  return ctx.state.recurringRules.flatMap((rule) => {
    if (
      type === "categories" &&
      rule.template.categoryId &&
      deletedIds.has(rule.template.categoryId)
    ) {
      const template = { ...rule.template, categoryId: null };
      // Only reactivate a dependency-paused rule once all of its dependencies are satisfied;
      // a user-paused rule is left exactly as it is. Why: dropping the category removes one
      // blocker, not necessarily every one, and clearing `pausedByDependency` unconditionally
      // would strand a rule whose account is still archived, because both reactivation gates
      // key off that flag.
      // The sweep of archived data never resumes anything: the rule becomes an ordinary
      // paused schedule, and the user decides whether to turn it back on.
      if (options.sweep && rule.pausedByDependency) {
        return [
          updateEntity(rule, {
            template,
            active: false,
            pausedByDependency: false,
          }),
        ];
      }
      if (!rule.active && rule.pausedByDependency) {
        const candidate = { ...rule, template };
        const restored = canActivateRecurringRule(
          candidate,
          ctx.state.accounts,
          ctx.state.categories,
        );
        return [
          updateEntity(rule, {
            template,
            active: restored,
            pausedByDependency: !restored,
          }),
        ];
      }
      return [updateEntity(rule, { template })];
    }
    if (
      type === "tags" &&
      rule.template.tagIds.some((id) => deletedIds.has(id))
    ) {
      return [
        updateEntity(rule, {
          template: {
            ...rule.template,
            tagIds: rule.template.tagIds.filter((id) => !deletedIds.has(id)),
          },
        }),
      ];
    }
    return [];
  });
}

/**
 * The budgets (and their current period snapshots) that lose a deleted category, tag or account
 * from their filters.
 */
function budgetChangesFor(
  ctx: FinanceContext,
  type: DeletableType,
  deletedIds: Set<string>,
) {
  // The current period's snapshot holds its own copy of the filters spend is measured with, and
  // `computeBudgetStatuses` reads that copy. It must follow the budget, or the deleted
  // category or tag keeps filtering the live total. Historical periods keep what they measured.
  const budgetPeriodChanges: BudgetPeriodSnapshot[] = [];
  const budgetChanges =
    type === "categories" || type === "tags" || type === "accounts"
      ? ctx.state.budgets.flatMap((budget) => {
          const filters =
            type === "categories"
              ? {
                  ...budget.filters,
                  categoryIds: budget.filters.categoryIds.filter(
                    (id) => !deletedIds.has(id),
                  ),
                }
              : type === "accounts"
                ? {
                    ...budget.filters,
                    accountIds: budget.filters.accountIds.filter(
                      (id) => !deletedIds.has(id),
                    ),
                  }
                : {
                    ...budget.filters,
                    tagIds: budget.filters.tagIds.filter(
                      (id) => !deletedIds.has(id),
                    ),
                  };
          const categoryLimits =
            type === "categories"
              ? budget.categoryLimits.filter(
                  (limit) => !deletedIds.has(limit.categoryId),
                )
              : budget.categoryLimits;
          if (
            filters.accountIds.length === budget.filters.accountIds.length &&
            filters.categoryIds.length === budget.filters.categoryIds.length &&
            filters.tagIds.length === budget.filters.tagIds.length &&
            categoryLimits.length === budget.categoryLimits.length
          )
            return [];
          // An emptied-out filter list means "match everything" to `budgetSpend`. The budget
          // is kept as it is and now covers all spending; the confirmation says so up front.
          const currentStart = resolvePeriod(budget.period, todayLocal()).start;
          const currentPeriod = ctx.state.budgetPeriods.find(
            (item) =>
              item.budgetId === budget.id && item.periodStart === currentStart,
          );
          if (currentPeriod)
            budgetPeriodChanges.push(
              updateEntity(currentPeriod, { filters, categoryLimits }),
            );
          return [updateEntity(budget, { filters, categoryLimits })];
        })
      : [];
  return { budgetChanges, budgetPeriodChanges };
}

// ---- Applying ---------------------------------------------------------------------------------

/** The rows to hand `putMany`, all in one call so the delete is atomic. */
export function deletionRecords(plan: DeletionPlan): StoredEntity[] {
  const {
    type,
    deleted,
    ruleChanges,
    deletedRules,
    contributions,
    orphanedContributions,
    budgetPeriods,
    budgetAdjustments,
    transactionChanges,
    discardedUpcoming,
    detachedCategories,
    budgetChanges,
    budgetPeriodChanges,
    goalChanges,
  } = plan;
  return [
    ...asRecords(type as EntityType, deleted),
    ...asRecords("recurringRules", ruleChanges),
    ...asRecords("recurringRules", deletedRules),
    ...asRecords("contributions", contributions),
    ...asRecords("contributions", orphanedContributions),
    ...asRecords("budgetPeriods", budgetPeriods),
    ...asRecords("budgetAdjustments", budgetAdjustments),
    ...asRecords("transactions", transactionChanges),
    ...asRecords("transactions", discardedUpcoming),
    ...asRecords("categories", detachedCategories),
    ...asRecords("budgets", budgetChanges),
    ...asRecords("budgetPeriods", budgetPeriodChanges),
    ...asRecords("goals", goalChanges),
  ];
}

/**
 * The occurrence keys of the transactions this delete removes, so recurring generation does not
 * post the same occurrence again.
 */
export function deletedOccurrenceKeysOf(plan: DeletionPlan): string[] {
  const keys: string[] = [];
  if (plan.type === "transactions") {
    plan.deleted.forEach((entity) => {
      const occurrenceKey = (entity as TransactionRecord).occurrenceKey;
      if (occurrenceKey) keys.push(occurrenceKey);
    });
  }
  plan.discardedUpcoming.forEach((item) => {
    if (item.occurrenceKey) keys.push(item.occurrenceKey);
  });
  return keys;
}

/** The snapshot with the plan applied: tombstoned rows dropped, dependent rows rewritten. */
export function applyDeletion(
  state: FinanceState,
  plan: DeletionPlan,
): FinanceState {
  const {
    type,
    deletedIds,
    ruleChanges,
    deletedRules,
    orphanedContributions,
    transactionChanges,
    discardedUpcoming,
    detachedCategories,
    budgetChanges,
    budgetPeriodChanges,
    goalChanges,
  } = plan;
  const nextState = {
    ...state,
    [type]: (state[type] as FinanceEntity[]).filter(
      (entity) => !deletedIds.has(entity.id),
    ),
  } as FinanceState;
  nextState.recurringRules = replaceById(nextState.recurringRules, ruleChanges);
  if (deletedRules.length) {
    const gone = new Set(deletedRules.map((rule) => rule.id));
    nextState.recurringRules = nextState.recurringRules.filter(
      (rule) => !gone.has(rule.id),
    );
  }
  nextState.transactions = replaceById(
    nextState.transactions,
    transactionChanges,
  );
  if (discardedUpcoming.length) {
    const discarded = new Set(discardedUpcoming.map((item) => item.id));
    nextState.transactions = nextState.transactions.filter(
      (item) => !discarded.has(item.id),
    );
  }
  if (orphanedContributions.length) {
    const retired = new Set(orphanedContributions.map((item) => item.id));
    nextState.contributions = nextState.contributions.filter(
      (item) => !retired.has(item.id),
    );
  }
  if (type === "goals") {
    nextState.contributions = nextState.contributions.filter(
      (item) => !deletedIds.has(item.goalId),
    );
  }
  if (type === "budgets") {
    nextState.budgetPeriods = nextState.budgetPeriods.filter(
      (item) => !deletedIds.has(item.budgetId),
    );
    nextState.budgetAdjustments = nextState.budgetAdjustments.filter(
      (item) => !deletedIds.has(item.budgetId),
    );
  }
  nextState.categories = replaceById(nextState.categories, detachedCategories);
  nextState.budgets = replaceById(nextState.budgets, budgetChanges);
  nextState.budgetPeriods = replaceById(
    nextState.budgetPeriods,
    budgetPeriodChanges,
  );
  nextState.goals = replaceById(nextState.goals, goalChanges);
  return nextState;
}
