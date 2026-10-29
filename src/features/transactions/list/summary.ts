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

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * `totals` (the repository's dashboard aggregate for `fromDate`..`toDate`) adjusted for the rows
 * that are pending an Undo, so the tiles agree with the list.
 *
 * - `hiddenIds`: a swiped-away row leaves the list at once but the repository keeps it until the
 *   Undo window ends, so without this the tiles would still count what the list no longer shows.
 *   Only rows the aggregate counts are subtracted.
 * - `payingIds`: a row being marked paid is drawn as posted at once, but the repository posts it only
 *   when the Undo window ends. Such an upcoming row is added to the tiles now, when its base amount
 *   is already known (see below).
 *
 * Both follow the aggregate's own rule: not deleted, inside the range, income or expense (never a
 * transfer), counted at its snapshotted `baseAmountMinor`; "counted" means posted for the first set
 * and upcoming for the second, which the aggregate counts once it is posted. Amounts are integer
 * minor units throughout.
 *
 * An upcoming row that is not priced yet (no `exchangeRate`, or no `baseAmountMinor`) is left out
 * on purpose: paying it prices it at the rate of the day it is committed, which cannot be known
 * before the commit, so the tiles pick it up when it posts rather than show a guess.
 */
export function totalsWithoutHidden(
  totals: RangeTotals,
  transactions: readonly TransactionRecord[],
  hiddenIds: ReadonlySet<string>,
  fromDate: string,
  toDate: string,
  payingIds: ReadonlySet<string> = NO_IDS,
): RangeTotals {
  if (hiddenIds.size === 0 && payingIds.size === 0) return totals;
  let incomeMinor = totals.incomeMinor;
  let expenseMinor = totals.expenseMinor;
  let changed = false;
  for (const transaction of transactions) {
    const hiding = hiddenIds.has(transaction.id);
    const paying = payingIds.has(transaction.id);
    if (
      (!hiding && !paying) ||
      transaction.deletedAt ||
      transaction.localDate < fromDate ||
      transaction.localDate > toDate ||
      transaction.baseAmountMinor === null
    )
      continue;
    // A hidden row is counted already if it is posted; a paying one is not until it posts, and
    // needs its rate fixed (see above). A row that is both is shown by neither.
    if (hiding) {
      if (transaction.status !== "posted") continue;
    } else if (
      transaction.status !== "upcoming" ||
      transaction.exchangeRate === null
    )
      continue;
    const apply = hiding ? subtractMinor : addMinor;
    if (transaction.kind === "income") {
      incomeMinor = apply(
        incomeMinor,
        transaction.baseAmountMinor,
        "Income total",
      );
      changed = true;
    } else if (transaction.kind === "expense") {
      expenseMinor = apply(
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
