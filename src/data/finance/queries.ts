import type { FinanceContext } from "@/data/finance/context";
import type { Category, TransactionQuery } from "@/domain/models";

/** Case- and accent-insensitive form for search, so "cafe" finds "Café". Uses no locale-sensitive collation. */
function foldForSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// A transaction record is immutable once in the snapshot (edits create a new object), so its
// folded searchable text is computed once instead of on every keystroke for every row.
const foldedSearchText = new WeakMap<object, string>();
function searchTextOf(transaction: { title: string; note: string }) {
  let folded = foldedSearchText.get(transaction);
  if (folded === undefined) {
    folded = foldForSearch(`${transaction.title} ${transaction.note}`);
    foldedSearchText.set(transaction, folded);
  }
  return folded;
}

// Pre-indexes the selected ids and the category tree once so hierarchy
// matching is O(depth) per transaction instead of O(categories) per transaction.
export function categoryMatcher(categories: Category[], selectedIds: string[]) {
  const selected = new Set(selectedIds);
  const byId = new Map(categories.map((category) => [category.id, category]));
  return (categoryId: string | null) => {
    if (!categoryId) return false;
    let currentId: string | null = categoryId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      if (selected.has(currentId)) return true;
      visited.add(currentId);
      currentId = byId.get(currentId)?.parentId ?? null;
    }
    return false;
  };
}

export function queryTransactions(
  ctx: FinanceContext,
  query: TransactionQuery = {},
  snapshot = ctx.state.transactions,
) {
  const normalizedSearch = query.search
    ? foldForSearch(query.search.trim())
    : undefined;
  const matchesCategory = query.categoryIds?.length
    ? categoryMatcher(ctx.state.categories, query.categoryIds)
    : null;
  let result = snapshot.filter((transaction) => {
    if (transaction.deletedAt) return false;
    if (
      normalizedSearch &&
      !searchTextOf(transaction).includes(normalizedSearch)
    )
      return false;
    if (
      query.accountIds?.length &&
      !query.accountIds.includes(transaction.accountId) &&
      !(
        transaction.kind === "transfer" &&
        transaction.destinationAccountId &&
        query.accountIds.includes(transaction.destinationAccountId)
      )
    )
      return false;
    // Hierarchy-aware, matching `budgetSpend` and goal progress. Why: a parent category that
    // matched only itself would return nothing for transactions filed under its children, so
    // the same category could read "spent 240.00" in a budget while the transaction list
    // filtered to it came back empty.
    if (matchesCategory && !matchesCategory(transaction.categoryId))
      return false;
    if (
      query.tagIds?.length &&
      !query.tagIds.some((id) => transaction.tagIds.includes(id))
    )
      return false;
    if (query.kinds?.length && !query.kinds.includes(transaction.kind))
      return false;
    if (query.statuses?.length && !query.statuses.includes(transaction.status))
      return false;
    if (query.fromDate && transaction.localDate < query.fromDate) return false;
    if (query.toDate && transaction.localDate > query.toDate) return false;
    // An unpriced (upcoming, no rate yet) transaction has no base amount to compare, so an amount
    // bound excludes it rather than matching on a value that does not exist.
    if (
      query.minMinor !== undefined &&
      (transaction.baseAmountMinor === null ||
        transaction.baseAmountMinor < query.minMinor)
    )
      return false;
    if (
      query.maxMinor !== undefined &&
      (transaction.baseAmountMinor === null ||
        transaction.baseAmountMinor > query.maxMinor)
    )
      return false;
    return true;
  });
  if (query.sort !== false) {
    result = result.sort((a, b) => {
      if (query.sort === "oldest")
        return (
          a.localDate.localeCompare(b.localDate) ||
          a.createdAt.localeCompare(b.createdAt)
        );
      if (query.sort === "amount-desc") {
        // Unpriced rows sort after priced ones, then by id so the order is deterministic.
        if (a.baseAmountMinor === null || b.baseAmountMinor === null)
          return (
            Number(a.baseAmountMinor === null) -
              Number(b.baseAmountMinor === null) || a.id.localeCompare(b.id)
          );
        return b.baseAmountMinor - a.baseAmountMinor;
      }
      return (
        b.localDate.localeCompare(a.localDate) ||
        b.createdAt.localeCompare(a.createdAt)
      );
    });
  }
  const offset = query.offset ?? 0;
  return result.slice(offset, query.limit ? offset + query.limit : undefined);
}
