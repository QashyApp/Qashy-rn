/**
 * Fee and principal arithmetic shared between the repository and the transaction UI.
 *
 * `TransactionRecord.amountMinor` always stays the TOTAL effect on the account (principal
 * plus or minus the fee), so balances, budgets, and analytics never need to know a
 * transaction carried a fee. These are the pure functions that keep that total consistent
 * with its parts — never floats, always `decimal.js` or the safe-integer helpers in
 * `@/utils/money`.
 */

import { Decimal } from "decimal.js";

import type { TransactionFeeInput, TransactionRecord } from "@/domain/models";
import { addMinor, isSafeMinor, subtractMinor } from "@/utils/money";

/**
 * Validates and normalizes a plain (non-localized) decimal percentage string.
 *
 * Takes an invariant decimal string — not a localized one. A caller with user-typed,
 * possibly localized input should run it through `normalizeDecimalString` from
 * `@/utils/money` first.
 */
export function normalizeFeePercent(value: string): string {
  let percent: Decimal;
  try {
    percent = new Decimal(value.trim());
  } catch {
    throw new Error("Fee percentage must be greater than 0 and at most 100.");
  }
  if (!percent.isFinite() || percent.lte(0) || percent.gt(100)) {
    throw new Error("Fee percentage must be greater than 0 and at most 100.");
  }
  // Plain fixed-point, like `normalizeDecimalString`: `toString` would emit exponent form for tiny values.
  return percent.toFixed();
}

/** The fee amount in account-currency minor units for a given principal and fee input. */
export function feeMinorFor(
  principalMinor: number,
  fee: TransactionFeeInput,
): number {
  if (fee.kind === "fixed") {
    if (!isSafeMinor(fee.amountMinor) || fee.amountMinor <= 0) {
      throw new Error("Fee must be greater than zero.");
    }
    return fee.amountMinor;
  }
  const percent = normalizeFeePercent(fee.percent);
  if (!isSafeMinor(principalMinor) || principalMinor <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const computed = new Decimal(principalMinor)
    .mul(percent)
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
  if (!isSafeMinor(computed))
    throw new Error("Fee is outside the supported range.");
  return computed;
}

/** The total (principal plus/minus fee) that `TransactionRecord.amountMinor` stores. */
export function totalWithFee(
  kind: "expense" | "income",
  principalMinor: number,
  feeMinor: number,
): number {
  if (kind === "expense") {
    return addMinor(principalMinor, feeMinor, "Amount");
  }
  const total = subtractMinor(principalMinor, feeMinor, "Amount");
  if (total <= 0) throw new Error("Fees can’t exceed the income amount.");
  return total;
}

/** Reverses `totalWithFee`: the principal a stored total and fee imply. */
export function principalOf(
  record: Pick<TransactionRecord, "kind" | "amountMinor" | "fee">,
): number {
  const fee = record.fee ?? null;
  if (!fee) return record.amountMinor;
  return record.kind === "expense"
    ? subtractMinor(record.amountMinor, fee.amountMinor, "Amount")
    : addMinor(record.amountMinor, fee.amountMinor, "Amount");
}
