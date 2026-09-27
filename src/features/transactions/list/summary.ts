import type { TransactionRecord } from '@/domain/models';
import { addMinor, subtractMinor } from '@/utils/money';

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
export function dayNetMinor(transactions: readonly TransactionRecord[]): number {
  let net = 0;
  for (const transaction of transactions) {
    if (transaction.kind === 'income') {
      net = addMinor(net, transaction.baseAmountMinor, 'Daily net');
    } else if (transaction.kind === 'expense') {
      net = subtractMinor(net, transaction.baseAmountMinor, 'Daily net');
    }
  }
  return net;
}
