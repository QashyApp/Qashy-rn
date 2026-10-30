import type { RecurringRule, TransactionRecord } from "@/domain/models";

/**
 * The generated occurrences of a recurring rule that are still waiting for review: not posted,
 * not deleted. Deleting the rule removes exactly these (posted ones stay in the ledger).
 */
export function pendingOccurrences(
  transactions: readonly TransactionRecord[],
  ruleId: string,
): TransactionRecord[] {
  return transactions.filter(
    (transaction) =>
      transaction.recurringRuleId === ruleId &&
      transaction.status === "upcoming" &&
      !transaction.deletedAt,
  );
}

/** The pending occurrences already due on `today`: what turning auto-post on posts right away. */
export function overdueOccurrences(
  transactions: readonly TransactionRecord[],
  ruleId: string,
  today: string,
): TransactionRecord[] {
  return pendingOccurrences(transactions, ruleId).filter(
    (transaction) => transaction.localDate <= today,
  );
}

/**
 * How many overdue occurrences saving `next` would post at once. Auto-post takes effect when it is
 * switched on, or when a paused rule that has it on is switched back on; a new rule has no
 * occurrences yet, and a rule that stays inactive posts nothing.
 */
export function overduePostedBySave(
  existing: Pick<RecurringRule, "id" | "autoPost" | "active"> | undefined,
  next: { autoPost: boolean; active: boolean },
  transactions: readonly TransactionRecord[],
  today: string,
): number {
  if (!existing || !next.autoPost || !next.active) return 0;
  if (existing.autoPost && existing.active) return 0;
  return overdueOccurrences(transactions, existing.id, today).length;
}
