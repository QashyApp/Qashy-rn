import { parseLocalDate } from '@/utils/date';

const DAY_MS = 86_400_000;

/** Whole calendar days between two local dates (UTC-normalized so DST never skews the count). */
function daysBetween(fromISO: string, toISO: string): number {
  const from = parseLocalDate(fromISO);
  const to = parseLocalDate(toISO);
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / DAY_MS);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export type BudgetPaceStatus = 'under' | 'onTrack' | 'over' | 'projectedOver';

export interface BudgetPaceResult {
  /** How far through the period `today` sits, clamped to [0, 1]. */
  elapsedRatio: number;
  /** How much of the limit has been spent. 0 when the limit is non-positive and nothing was spent. */
  spentRatio: number;
  /** Spend projected across the full period at the current daily pace, rounded to a safe integer minor amount. */
  projectedMinor: number;
  status: BudgetPaceStatus;
}

/** Spend/elapsed-time slack, in ratio points, before pace reads as "over" or "under" rather than "on track". */
const ON_TRACK_TOLERANCE = 0.05;

/**
 * A display-only projection of a budget's pace: how far through the period
 * `today` sits versus how much of the limit is already spent, and what that
 * pace would total by the period's end.
 *
 * This is presentation math, not a persisted figure — the caller rounds the
 * projection for display and never writes it back to a record. Every input
 * and output here is a safe-integer minor amount or a [0, 1] ratio; nothing
 * here parses or produces a float amount.
 */
export function budgetPace({
  spentMinor,
  limitMinor,
  periodStart,
  periodEnd,
  today,
}: {
  spentMinor: number;
  limitMinor: number;
  periodStart: string;
  periodEnd: string;
  today: string;
}): BudgetPaceResult {
  const totalDays = Math.max(1, daysBetween(periodStart, periodEnd) + 1);
  const elapsedDaysRaw = daysBetween(periodStart, today) + 1;
  const elapsedDays = Math.max(0, Math.min(totalDays, elapsedDaysRaw));
  const elapsedRatio = clamp01(elapsedDays / totalDays);
  const spentRatio = limitMinor > 0 ? spentMinor / limitMinor : spentMinor > 0 ? 1 : 0;
  // With no elapsed time to divide by, there is no pace to extrapolate — the
  // best available "projection" is simply what has been spent so far.
  const projectedMinor = elapsedRatio > 0 ? Math.round(spentMinor / elapsedRatio) : spentMinor;

  let status: BudgetPaceStatus;
  if (limitMinor <= 0) {
    status = spentMinor > 0 ? 'over' : 'onTrack';
  } else if (spentMinor > limitMinor) {
    status = 'over';
  } else if (projectedMinor > limitMinor) {
    status = 'projectedOver';
  } else if (spentRatio < elapsedRatio - ON_TRACK_TOLERANCE) {
    status = 'under';
  } else {
    status = 'onTrack';
  }

  return { elapsedRatio, spentRatio, projectedMinor, status };
}
