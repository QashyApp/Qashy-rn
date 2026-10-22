import type { FinanceState, TransactionRecord } from "@/domain/models";

/**
 * What the finance rules in this folder read from the repository.
 *
 * A live view, not a copy: `state` and `formatLocale` are getters on the repository, so a rule
 * that reads `ctx.state` sees exactly what `this.state` would have shown at that moment,
 * including the temporary snapshot `withProspectiveState` swaps in while an import validates.
 * Read it where you use it and do not hold on to it across an `await`.
 *
 * The two lookups are the repository's per-snapshot caches (kept on the class, keyed by the
 * identity of the snapshot arrays), exposed so the rules can share them.
 */
export interface FinanceContext {
  readonly state: FinanceState;
  readonly formatLocale: string;
  /** Posted rows, and posted rows of a date window, shared by every caller of one snapshot. */
  postedTransactions(fromDate?: string, toDate?: string): TransactionRecord[];
  /** An id index of `transactions`, built once per snapshot array. */
  transactionById(
    transactions: TransactionRecord[],
  ): Map<string, TransactionRecord>;
}
