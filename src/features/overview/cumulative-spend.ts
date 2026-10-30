import type { DashboardSummary } from "@/domain/models";

/**
 * The running total of spending for each elapsed day of a range. Days after `today` have not
 * happened, so they add no points (a flat tail would read as "spent nothing since"): a past month
 * keeps all of its days, the current month stops at today, and a month wholly ahead is empty.
 */
export function cumulativeSpend(
  dailySpend: DashboardSummary["dailySpend"],
  today: string,
): number[] {
  const running: number[] = [];
  let total = 0;
  for (const day of dailySpend) {
    if (day.date > today) break;
    total += day.amountMinor;
    running.push(total);
  }
  return running;
}
