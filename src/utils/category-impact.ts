import type { Budget } from "@/domain/models";

/**
 * Budgets that `LocalFinanceRepository.deleteEntitiesNow` archives when `categoryIds` are
 * deleted: a budget whose only category filter is being removed (and that has no account or tag
 * filter) would otherwise match every expense, so the repository archives it instead. Mirrors that
 * rule so the confirmation can name the budgets the user is about to lose from Plan.
 */
export function budgetsArchivedByCategoryDeletion(
  budgets: readonly Budget[],
  categoryIds: readonly string[],
): Budget[] {
  const removed = new Set(categoryIds);
  return budgets.filter(
    (budget) =>
      !budget.deletedAt &&
      !budget.archived &&
      budget.filters.categoryIds.some((id) => removed.has(id)) &&
      budget.filters.categoryIds.every((id) => removed.has(id)) &&
      !budget.filters.accountIds.length &&
      !budget.filters.tagIds.length,
  );
}

export function categoryDeletionMessage(
  budgets: readonly Budget[],
  categoryIds: readonly string[],
) {
  const base =
    categoryIds.length === 1
      ? "Transactions in this category become uncategorized, and it is removed from budgets and goals."
      : "Transactions in these categories become uncategorized, and the categories are removed from budgets and goals.";
  const archived = budgetsArchivedByCategoryDeletion(budgets, categoryIds);
  if (!archived.length) return base;
  const names = archived.map((budget) => `“${budget.name}”`).join(", ");
  return `${base} ${archived.length === 1 ? "The budget" : "These budgets"} ${names} would then track nothing, so ${archived.length === 1 ? "it is" : "they are"} archived and leave Plan. Edit ${archived.length === 1 ? "its" : "their"} categories first to keep ${archived.length === 1 ? "it" : "them"}.`;
}
