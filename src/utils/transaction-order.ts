import type { TransactionRecord, TransactionQuery } from "@/domain/models";

type Order = Exclude<TransactionQuery["sort"], false | undefined>;

/** Plain code-unit order: `localDate` and `createdAt` are fixed-width ISO strings, so it equals calendar order. */
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The comparator of a transaction list order; `newest` is the default. */
export function transactionComparator(
  order: Order | undefined,
): (a: TransactionRecord, b: TransactionRecord) => number {
  if (order === "oldest")
    return (a, b) =>
      ordinal(a.localDate, b.localDate) || ordinal(a.createdAt, b.createdAt);
  if (order === "amount-desc")
    return (a, b) => {
      // Unpriced rows sort after priced ones, then by id so the order is deterministic.
      if (a.baseAmountMinor === null || b.baseAmountMinor === null)
        return (
          Number(a.baseAmountMinor === null) -
            Number(b.baseAmountMinor === null) || ordinal(a.id, b.id)
        );
      return b.baseAmountMinor - a.baseAmountMinor;
    };
  return (a, b) =>
    ordinal(b.localDate, a.localDate) || ordinal(b.createdAt, a.createdAt);
}

/**
 * The first `count` items of `items` in `compare` order, exactly as `[...items].sort(compare)
 * .slice(0, count)` returns them (ties keep their input order), without sorting the rest. Each
 * item costs one comparison against the current cut-off, so a long ledger is one pass.
 */
export function selectFirst<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number,
  count: number,
): T[] {
  if (count >= items.length) return [...items].sort(compare);
  const top: T[] = [];
  for (const item of items) {
    if (top.length === count && compare(item, top[count - 1]) >= 0) continue;
    // Insert after every item that is not greater, which keeps the earlier of two equal items first.
    let index = top.length;
    top.push(item);
    while (index > 0 && compare(top[index - 1], item) > 0) {
      top[index] = top[index - 1];
      index -= 1;
    }
    top[index] = item;
    if (top.length > count) top.pop();
  }
  return top;
}
