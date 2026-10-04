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

/** Marks the one section that gathers upcoming transactions instead of a calendar day. */
export const UPCOMING_SECTION = "upcoming";

export interface LedgerSection<T> extends DaySection<T> {
  /** Set on the upcoming group, whose `title` is not a date. */
  readonly kind?: "upcoming";
  /** How many rows the group holds, which stays known while a collapsed group's `data` is empty. */
  readonly count?: number;
}

/**
 * Day sections, with upcoming transactions pulled out into one group at the top.
 *
 * Upcoming rows (recurring items still due, imported future dates) are not things that happened,
 * so interleaving them by date made a month read as if they had. As a group they can be collapsed
 * out of the way. A collapsed group keeps its header and `count` but holds no rows, so the list
 * does not render them at all.
 */
export function groupLedgerSections<
  T extends { readonly localDate: string; readonly status: string },
>(
  transactions: readonly T[],
  options: { groupUpcoming: boolean; upcomingCollapsed: boolean },
): LedgerSection<T>[] {
  if (!options.groupUpcoming) return groupTransactionsByDay(transactions);
  const upcoming = transactions.filter((item) => item.status === "upcoming");
  if (upcoming.length === 0) return groupTransactionsByDay(transactions);
  const days = groupTransactionsByDay(
    transactions.filter((item) => item.status !== "upcoming"),
  );
  return [
    {
      title: UPCOMING_SECTION,
      kind: "upcoming",
      count: upcoming.length,
      data: options.upcomingCollapsed ? [] : upcoming,
    },
    ...days,
  ];
}
