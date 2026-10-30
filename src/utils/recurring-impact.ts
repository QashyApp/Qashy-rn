import type { RecurringRule, TransactionRecord } from "@/domain/models";
import { firstRecurrenceOnOrAfter } from "@/utils/date";

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
 * occurrences yet, and a rule that stays inactive posts nothing. `canPost` is the pricing check
 * generation uses: an occurrence it rejects (no exchange rate stored yet) stays upcoming, so it is
 * not counted. Without it every overdue occurrence counts.
 */
export function overduePostedBySave(
  existing: Pick<RecurringRule, "id" | "autoPost" | "active"> | undefined,
  next: { autoPost: boolean; active: boolean },
  transactions: readonly TransactionRecord[],
  today: string,
  canPost: (transaction: TransactionRecord) => boolean = () => true,
): number {
  if (!existing || !next.autoPost || !next.active) return 0;
  if (existing.autoPost && existing.active) return 0;
  return overdueOccurrences(transactions, existing.id, today).filter(canPost)
    .length;
}

/**
 * The next due date a paused schedule gets when it is switched back on. Generation only walks
 * active rules, so a paused rule's `nextDueDate` stands still; pausing means the dates in between
 * are skipped, never backfilled. A stale date (before `today`) moves to the schedule's first
 * occurrence on or after today, the same rule a new schedule with a past start follows. A date
 * that is today or later is kept. Pure: the data layer applies it on save, and the form and the
 * schedule list use it to show a long-expired paused schedule as ended.
 */
export function nextDueDateOnReactivation(
  rule: Pick<RecurringRule, "unit" | "interval" | "startDate" | "nextDueDate">,
  today: string,
): string {
  if (rule.nextDueDate >= today) return rule.nextDueDate;
  return firstRecurrenceOnOrAfter(
    rule.startDate,
    rule.unit,
    rule.interval,
    rule.startDate > today ? rule.startDate : today,
  );
}
