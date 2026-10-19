import type {
  BundleAccount,
  BundleBudget,
  BundleCategory,
  BundleRecurringRule,
  BundleTransaction,
} from "@/data/import/types";

/** The parts of an import bundle that can carry the source app's archived flag. */
export interface ArchivableParts {
  accounts: BundleAccount[];
  categories: BundleCategory[];
  transactions: BundleTransaction[];
  recurringRules: BundleRecurringRule[];
  budgets: BundleBudget[];
}

export interface OmittedArchived {
  accounts: number;
  categories: number;
  /** Budgets that were themselves archived and so not imported. */
  budgets: number;
  /**
   * Kept budgets that lost every account or every category filter to omission, and so now cover
   * all accounts or all categories. Each budget is counted once.
   */
  budgetsBroadened: number;
  /** Transactions dropped because they were booked on an archived account. */
  transactions: number;
  /** Transfers with one archived side, kept as income or expense on the other side. */
  transfersKept: number;
  recurringRules: number;
}

/**
 * Leaves out everything the source app had archived, because nothing is archived here: deleting
 * erases, and an archived item is one the user had already put away.
 *
 * - An archived account is not imported, nor are its transactions or schedules. A transfer between
 *   it and an imported account is kept as income (the archived side was the source) or expense (it
 *   was the destination) on the imported side, so that account's balance still matches.
 * - An archived category is not imported; what used it is imported uncategorized, and its
 *   subcategories become top-level.
 * - An archived budget is not imported. A live budget is always kept: omitted accounts and
 *   categories are removed from its filters, and a filter list that ends up empty means
 *   unfiltered for that dimension, exactly as deleting an account or category in the app does.
 *
 * Pure and idempotent: a bundle with nothing archived comes back as it was.
 */
export function omitArchived<T extends ArchivableParts>(
  parts: T,
): { parts: T; omitted: OmittedArchived } {
  const archivedAccounts = new Set(
    parts.accounts
      .filter((item) => item.archived)
      .map((item) => item.externalId),
  );
  const archivedCategories = new Set(
    parts.categories
      .filter((item) => item.archived)
      .map((item) => item.externalId),
  );
  const omitted: OmittedArchived = {
    accounts: archivedAccounts.size,
    categories: archivedCategories.size,
    budgets: 0,
    budgetsBroadened: 0,
    transactions: 0,
    transfersKept: 0,
    recurringRules: 0,
  };
  if (
    !archivedAccounts.size &&
    !archivedCategories.size &&
    !parts.budgets.some((item) => item.archived)
  )
    return { parts, omitted };

  const droppedRules = new Set<string>();
  const recurringRules: BundleRecurringRule[] = [];
  for (const rule of parts.recurringRules) {
    if (archivedAccounts.has(rule.accountExternalId)) {
      droppedRules.add(rule.externalId);
      omitted.recurringRules += 1;
      continue;
    }
    recurringRules.push(
      rule.categoryExternalId && archivedCategories.has(rule.categoryExternalId)
        ? { ...rule, categoryExternalId: null }
        : rule,
    );
  }

  const transactions: BundleTransaction[] = [];
  for (const item of parts.transactions) {
    let next = item;
    if (item.kind === "transfer") {
      const sourceGone = archivedAccounts.has(item.accountExternalId);
      const destinationGone =
        item.destinationAccountExternalId !== null &&
        archivedAccounts.has(item.destinationAccountExternalId);
      if (sourceGone && destinationGone) {
        omitted.transactions += 1;
        continue;
      }
      if (sourceGone && item.destinationAccountExternalId !== null) {
        next = {
          ...item,
          kind: "income",
          accountExternalId: item.destinationAccountExternalId,
          destinationAccountExternalId: null,
          amountMinor: item.destinationAmountMinor ?? item.amountMinor,
          destinationAmountMinor: null,
        };
        omitted.transfersKept += 1;
      } else if (destinationGone) {
        next = {
          ...item,
          kind: "expense",
          destinationAccountExternalId: null,
          destinationAmountMinor: null,
        };
        omitted.transfersKept += 1;
      }
    } else if (archivedAccounts.has(item.accountExternalId)) {
      omitted.transactions += 1;
      continue;
    }
    if (
      next.categoryExternalId &&
      archivedCategories.has(next.categoryExternalId)
    )
      next = { ...next, categoryExternalId: null };
    if (
      next.recurringRuleExternalId &&
      droppedRules.has(next.recurringRuleExternalId)
    )
      next = { ...next, recurringRuleExternalId: null };
    transactions.push(next);
  }

  const categories = parts.categories
    .filter((item) => !item.archived)
    .map((item) =>
      item.parentExternalId && archivedCategories.has(item.parentExternalId)
        ? { ...item, parentExternalId: null }
        : item,
    );

  const budgets: BundleBudget[] = [];
  for (const budget of parts.budgets) {
    const accountExternalIds = budget.accountExternalIds.filter(
      (id) => !archivedAccounts.has(id),
    );
    const categoryExternalIds = budget.categoryExternalIds.filter(
      (id) => !archivedCategories.has(id),
    );
    if (budget.archived) {
      omitted.budgets += 1;
      continue;
    }
    if (
      (budget.accountExternalIds.length > 0 && !accountExternalIds.length) ||
      (budget.categoryExternalIds.length > 0 && !categoryExternalIds.length)
    )
      omitted.budgetsBroadened += 1;
    budgets.push({
      ...budget,
      accountExternalIds,
      categoryExternalIds,
      categoryLimits: budget.categoryLimits.filter(
        (limit) => !archivedCategories.has(limit.categoryExternalId),
      ),
    });
  }

  return {
    parts: {
      ...parts,
      accounts: parts.accounts.filter((item) => !item.archived),
      categories,
      transactions,
      recurringRules,
      budgets,
    },
    omitted,
  };
}
