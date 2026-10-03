export interface DaySection<T> {
  readonly title: string;
  readonly data: T[];
}

/**
 * Groups already-ordered transactions into one section per `localDate`, keeping the
 * incoming order (days appear in first-seen order, rows keep their relative order).
 * Pure so every month page of the pager can derive its own sections.
 */
export function groupTransactionsByDay<
  T extends { readonly localDate: string },
>(transactions: readonly T[]): DaySection<T>[] {
  const groups = new Map<string, T[]>();
  for (const transaction of transactions) {
    const list = groups.get(transaction.localDate);
    if (list) list.push(transaction);
    else groups.set(transaction.localDate, [transaction]);
  }
  return Array.from(groups, ([title, data]) => ({ title, data }));
}
