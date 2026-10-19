import { unfilteredBudgetsMessage } from "@/utils/category-impact";
import type {
  Budget,
  FinanceState,
  Goal,
  RecurringRule,
  TransactionRecord,
} from "@/domain/models";

/** The slice of the finance snapshot an account deletion reads. */
export type AccountDeletionState = Pick<
  FinanceState,
  "accounts" | "transactions" | "recurringRules" | "budgets" | "goals"
>;

/** A transfer whose other side survives: it stays, as plain income or expense on `keepAccountId`. */
export interface TransferConversion {
  transaction: TransactionRecord;
  keepAccountId: string;
  /** `income` when the deleted account was the source, `expense` when it was the destination. */
  as: "income" | "expense";
}

export interface AccountDeletionPlan {
  accountIds: ReadonlySet<string>;
  /** Schedules whose account is deleted. They go with it. */
  rules: RecurringRule[];
  /** Transactions that are deleted: booked on a deleted account, or upcoming from a deleted schedule. */
  deletedTransactions: TransactionRecord[];
  conversions: TransferConversion[];
  /** Posted or skipped occurrences of a deleted schedule that stay, with the schedule link cleared. */
  releasedTransactions: TransactionRecord[];
  /** Budgets that filter by a deleted account. */
  budgets: Budget[];
  /** Goals linked to a deleted account. */
  goals: Goal[];
}

/**
 * What deleting `accountIds` does to everything that points at them. Pure, and the single source of
 * the rule: `LocalFinanceRepository` applies exactly this plan and the confirmation dialog
 * describes exactly this plan, so what the user is told is what happens.
 *
 * - Transactions on a deleted account are deleted.
 * - A transfer between a deleted and a surviving account is kept, as income (the deleted side was
 *   the source) or expense (it was the destination) on the surviving account. A transfer between
 *   two deleted accounts, or whose other side does not exist, is deleted.
 * - Schedules on a deleted account are deleted with their upcoming occurrences; posted and skipped
 *   occurrences stay, detached.
 */
export function planAccountDeletion(
  state: AccountDeletionState,
  accountIds: readonly string[],
): AccountDeletionPlan {
  const ids = new Set(accountIds);
  const survivors = new Set(
    state.accounts
      .filter((account) => !account.deletedAt && !ids.has(account.id))
      .map((account) => account.id),
  );
  const rules = state.recurringRules.filter(
    (rule) => !rule.deletedAt && ids.has(rule.template.accountId),
  );
  const ruleIds = new Set(rules.map((rule) => rule.id));

  const deletedTransactions: TransactionRecord[] = [];
  const conversions: TransferConversion[] = [];
  const releasedTransactions: TransactionRecord[] = [];
  for (const transaction of state.transactions) {
    if (transaction.deletedAt) continue;
    const ofDeletedRule =
      transaction.recurringRuleId !== null &&
      ruleIds.has(transaction.recurringRuleId);
    if (ofDeletedRule && transaction.status === "upcoming") {
      deletedTransactions.push(transaction);
      continue;
    }
    const sourceGone = ids.has(transaction.accountId);
    const destinationGone =
      transaction.kind === "transfer" &&
      transaction.destinationAccountId !== null &&
      ids.has(transaction.destinationAccountId);
    if (!sourceGone && !destinationGone) {
      if (ofDeletedRule) releasedTransactions.push(transaction);
      continue;
    }
    if (transaction.kind !== "transfer" || (sourceGone && destinationGone)) {
      deletedTransactions.push(transaction);
      continue;
    }
    const keepAccountId = sourceGone
      ? transaction.destinationAccountId
      : transaction.accountId;
    if (!keepAccountId || !survivors.has(keepAccountId)) {
      deletedTransactions.push(transaction);
      continue;
    }
    conversions.push({
      transaction,
      keepAccountId,
      as: sourceGone ? "income" : "expense",
    });
  }

  return {
    accountIds: ids,
    rules,
    deletedTransactions,
    conversions,
    releasedTransactions,
    budgets: state.budgets.filter(
      (budget) =>
        !budget.deletedAt &&
        budget.filters.accountIds.some((id) => ids.has(id)),
    ),
    goals: state.goals.filter(
      (goal) =>
        !goal.deletedAt &&
        goal.linkedAccountId !== null &&
        ids.has(goal.linkedAccountId),
    ),
  };
}

/** Budgets that filter by nothing but the deleted accounts: they are kept, and cover all spending. */
export function budgetsLeftUnfilteredByAccountDeletion(
  plan: AccountDeletionPlan,
): Budget[] {
  return plan.budgets.filter(
    (budget) =>
      budget.filters.accountIds.every((id) => plan.accountIds.has(id)) &&
      !budget.filters.categoryIds.length &&
      !budget.filters.tagIds.length,
  );
}

export interface AccountDeletionImpact {
  transactionCount: number;
  scheduleCount: number;
  /** Surviving accounts that receive converted transfers, in account order, with how many. */
  conversions: { accountId: string; accountName: string; count: number }[];
  unfilteredBudgets: Budget[];
  hasBudgetsOrGoals: boolean;
}

export function accountDeletionImpact(
  state: AccountDeletionState,
  accountIds: readonly string[],
): AccountDeletionImpact {
  const plan = planAccountDeletion(state, accountIds);
  const counts = new Map<string, number>();
  for (const conversion of plan.conversions)
    counts.set(
      conversion.keepAccountId,
      (counts.get(conversion.keepAccountId) ?? 0) + 1,
    );
  return {
    transactionCount: plan.deletedTransactions.length,
    scheduleCount: plan.rules.length,
    conversions: state.accounts
      .filter((account) => counts.has(account.id))
      .map((account) => ({
        accountId: account.id,
        accountName: account.name,
        count: counts.get(account.id)!,
      })),
    unfilteredBudgets: budgetsLeftUnfilteredByAccountDeletion(plan),
    hasBudgetsOrGoals: plan.budgets.length > 0 || plan.goals.length > 0,
  };
}

/**
 * The confirmation for deleting accounts, one sentence per line so each translates on its own.
 * The counts and names are computed from the same plan the repository applies.
 */
export function accountDeletionMessage(
  state: AccountDeletionState,
  accountIds: readonly string[],
): string[] {
  const impact = accountDeletionImpact(state, accountIds);
  const lines: string[] = [
    accountIds.length === 1
      ? "The account leaves your net worth."
      : "The accounts leave your net worth.",
  ];
  if (impact.transactionCount)
    lines.push(
      impact.transactionCount === 1
        ? "Deletes 1 transaction."
        : `Deletes ${impact.transactionCount} transactions.`,
    );
  if (impact.scheduleCount)
    lines.push(
      impact.scheduleCount === 1
        ? "Deletes 1 recurring schedule."
        : `Deletes ${impact.scheduleCount} recurring schedules.`,
    );
  if (impact.conversions.length) {
    const names = impact.conversions
      .map((item) => `${item.accountName} (${item.count})`)
      .join(", ");
    lines.push(
      `Transfers with an account that stays are kept as income or expense there: ${names}.`,
    );
  }
  if (impact.unfilteredBudgets.length)
    lines.push(unfilteredBudgetsMessage(impact.unfilteredBudgets));
  if (impact.hasBudgetsOrGoals)
    lines.push(
      "Budgets that use it are updated, and goals linked to it are unlinked.",
    );
  return lines;
}
