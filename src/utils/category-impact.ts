import type { Budget } from "@/domain/models";

/**
 * Budgets left with no filter at all when `categoryIds` are deleted: a budget whose only category
 * filter is being removed (and that has no account or tag filter) matches every expense. It is
 * kept, not removed, so the confirmation can tell the user it will then cover all their spending.
 * Mirrors the rule in `LocalFinanceRepository.deleteEntitiesNow`.
 */
export function budgetsLeftUnfilteredByCategoryDeletion(
  budgets: readonly Budget[],
  categoryIds: readonly string[],
): Budget[] {
  const removed = new Set(categoryIds);
  return budgets.filter(
    (budget) =>
      !budget.deletedAt &&
      budget.filters.categoryIds.some((id) => removed.has(id)) &&
      budget.filters.categoryIds.every((id) => removed.has(id)) &&
      !budget.filters.accountIds.length &&
      !budget.filters.tagIds.length,
  );
}

/** The sentence naming budgets that would cover all spending once their last filter is gone. */
export function unfilteredBudgetsMessage(budgets: readonly Budget[]): string {
  const names = budgets.map((budget) => `“${budget.name}”`).join(", ");
  return budgets.length === 1
    ? `The budget ${names} would then cover all your spending.`
    : `These budgets ${names} would then cover all your spending.`;
}

/** The confirmation for deleting categories, one sentence per line so each translates on its own. */
export function categoryDeletionMessage(
  budgets: readonly Budget[],
  categoryIds: readonly string[],
): string[] {
  const lines = [
    categoryIds.length === 1
      ? "Transactions in this category become uncategorized, and it is removed from budgets and goals."
      : "Transactions in these categories become uncategorized, and the categories are removed from budgets and goals.",
  ];
  const unfiltered = budgetsLeftUnfilteredByCategoryDeletion(
    budgets,
    categoryIds,
  );
  if (unfiltered.length) lines.push(unfilteredBudgetsMessage(unfiltered));
  return lines;
}
