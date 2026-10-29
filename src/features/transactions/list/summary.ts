import type { TransactionRecord } from "@/domain/models";
import { addMinor, subtractMinor } from "@/utils/money";

/**
 * The net flow of one day's transactions, in the base currency's minor units.
 *
 * Uses each transaction's snapshotted `baseAmountMinor` (never `amountMinor`,
 * which stays in the transaction's own currency) so a day mixing currencies
 * still totals correctly — the same convention `getDashboard` uses for its
 * month totals. Transfers move money between the user's own accounts and
 * never count as income or expense, so they are excluded here too.
 *
 * Unlike `getDashboard`, this deliberately sums whatever is passed in rather
 * than filtering to `posted` transactions: it exists to label a day *group*
 * that a filtered ledger view is already showing (which may include upcoming
 * transactions when the "Upcoming" or "All" filter is active), and the header
 * should total the rows actually listed beneath it.
 */
export function dayNetMinor(
  transactions: readonly TransactionRecord[],
): number {
  let net = 0;
  for (const transaction of transactions) {
    // An unpriced upcoming transaction (no rate yet) has no base value to total; it counts once paid.
    if (transaction.baseAmountMinor === null) continue;
    if (transaction.kind === "income") {
      net = addMinor(net, transaction.baseAmountMinor, "Daily net");
    } else if (transaction.kind === "expense") {
      net = subtractMinor(net, transaction.baseAmountMinor, "Daily net");
    }
  }
  return net;
}

/** The month totals the transactions screen shows as its summary tiles. */
export interface RangeTotals {
  incomeMinor: number;
  expenseMinor: number;
  netFlowMinor: number;
}

/**
 * `totals` (the repository's dashboard aggregate for `fromDate`..`toDate`) with the rows that are
 * pending an Undo taken out. A swiped-away row leaves the list at once but the repository keeps it
 * until the Undo window ends, so without this the tiles would still count what the list no longer
 * shows. Only rows the aggregate counts are subtracted, by the same rule it uses: posted, not
 * deleted, inside the range, income or expense (never a transfer) and priced in the base currency.
 * Amounts are integer minor units throughout.
 */
export function totalsWithoutHidden(
  totals: RangeTotals,
  transactions: readonly TransactionRecord[],
  hiddenIds: ReadonlySet<string>,
  fromDate: string,
  toDate: string,
): RangeTotals {
  if (hiddenIds.size === 0) return totals;
  let incomeMinor = totals.incomeMinor;
  let expenseMinor = totals.expenseMinor;
  let changed = false;
  for (const transaction of transactions) {
    if (
      !hiddenIds.has(transaction.id) ||
      transaction.deletedAt ||
      transaction.status !== "posted" ||
      transaction.localDate < fromDate ||
      transaction.localDate > toDate ||
      transaction.baseAmountMinor === null
    )
      continue;
    if (transaction.kind === "income") {
      incomeMinor = subtractMinor(
        incomeMinor,
        transaction.baseAmountMinor,
        "Income total",
      );
      changed = true;
    } else if (transaction.kind === "expense") {
      expenseMinor = subtractMinor(
        expenseMinor,
        transaction.baseAmountMinor,
        "Expense total",
      );
      changed = true;
    }
  }
  if (!changed) return totals;
  return {
    incomeMinor,
    expenseMinor,
    netFlowMinor: subtractMinor(incomeMinor, expenseMinor, "Net flow"),
  };
}
