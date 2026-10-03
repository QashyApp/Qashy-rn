/**
 * "What rate would apply right now" for one currency, as of one local date.
 *
 * Pure and read-only: it looks at the one `FinanceState.exchangeRates` array the repository
 * already holds and picks the same row `LocalFinanceRepository`'s private `directOrInverseRate`
 * would pick for converting `currency` into the vault's base currency — a live direct row
 * (`currency` → base) if one exists on or before `localDate`, else the inverse of a live
 * base → `currency` row. Both branches use the repository's own ordering (`effectiveDate` desc,
 * then `updatedAt` desc) so the transaction form's preview never disagrees with what saving the
 * transaction would actually resolve to.
 *
 * `appliedRateFor` intentionally does not triangulate through the base currency for two
 * *foreign* currencies the way `resolveRate` does for a cross-currency transfer's second leg
 * — the transaction form only ever previews the source leg (`currency` → base), which is
 * always a direct-or-inverse lookup, never a triangulation. `appliedCrossRateFor`, below, is
 * the one that does triangulate — it previews a foreign-amount leg, which can be priced in a
 * currency that is neither the account's nor the vault's base.
 */

import { Decimal } from "decimal.js";

import type { ExchangeRate, FinanceState } from "@/domain/models";
import { isFetchedRate } from "@/utils/deterministic-id";

export interface AppliedRate {
  /** `1 currency = rate <base currency>`, as a plain decimal string. */
  readonly rate: string;
  /** The date the winning row is effective as of — not necessarily `localDate` itself. */
  readonly effectiveDate: string;
  /** Whether the winning row is one `saveFetchedRates` wrote, vs. a manual entry. */
  readonly automatic: boolean;
}

function activeRates(state: FinanceState): ExchangeRate[] {
  return state.exchangeRates.filter((rate) => !rate.deletedAt);
}

function latestRate(
  rates: readonly ExchangeRate[],
  fromCurrency: string,
  toCurrency: string,
  localDate: string,
): ExchangeRate | undefined {
  return rates
    .filter(
      (item) =>
        item.fromCurrency === fromCurrency &&
        item.toCurrency === toCurrency &&
        item.effectiveDate <= localDate,
    )
    .sort(
      (a, b) =>
        b.effectiveDate.localeCompare(a.effectiveDate) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0];
}

/**
 * The rate that would currently apply to converting one unit of `currency` into the vault's
 * base currency as of `localDate`. `null` when neither a direct nor an inverse row covers that
 * date — the same condition under which the repository's own `resolveRate` would throw
 * "Missing exchange rate" for this leg.
 *
 * Returns `null`, not `'1'`, when `currency` already equals the base currency: there is nothing
 * to apply, and callers (the transaction form) only ask this for a genuinely foreign leg.
 */
export function appliedRateFor(
  state: FinanceState,
  currency: string,
  localDate: string,
): AppliedRate | null {
  const base = state.settings.baseCurrency.trim().toUpperCase();
  const foreign = currency.trim().toUpperCase();
  if (!foreign || foreign === base) return null;

  const rates = activeRates(state);

  const direct = directOrInverseApplied(rates, foreign, base, localDate);
  if (direct) return direct;
  return null;
}

/**
 * A direct `from` → `to` row on or before `localDate`, or — failing that — the inverse of a
 * `to` → `from` row, mirroring `LocalFinanceRepository`'s private `directOrInverseRate`
 * exactly: same ordering (`effectiveDate` desc, then `updatedAt` desc), same
 * `toSignificantDigits(20)` rounding when inverting. `null` when neither direction covers
 * the date.
 */
function directOrInverseApplied(
  rates: readonly ExchangeRate[],
  fromCurrency: string,
  toCurrency: string,
  localDate: string,
): AppliedRate | null {
  const direct = latestRate(rates, fromCurrency, toCurrency, localDate);
  if (direct) {
    return {
      rate: direct.rate,
      effectiveDate: direct.effectiveDate,
      automatic: isFetchedRate(direct),
    };
  }
  const inverse = latestRate(rates, toCurrency, fromCurrency, localDate);
  if (!inverse) return null;
  const inverseRate = new Decimal(inverse.rate);
  if (!inverseRate.isFinite() || inverseRate.lte(0)) return null;
  return {
    rate: new Decimal(1).div(inverseRate).toSignificantDigits(20).toFixed(),
    effectiveDate: inverse.effectiveDate,
    automatic: isFetchedRate(inverse),
  };
}

/**
 * "What rate would apply right now" for converting `fromCurrency` into `toCurrency` as of
 * `localDate` — a preview of the repository's private `resolveRate`, for a transaction's
 * foreign-amount leg (a currency that may equal neither the account's currency nor the
 * vault's base currency).
 *
 * A direct-or-inverse row between the two currencies wins first, exactly like
 * `appliedRateFor`. Failing that, it pivots through the vault's base currency the same way
 * `resolveRate` does for a cross-currency transfer's second leg: a `fromCurrency` → base leg
 * and a `toCurrency` → base leg, each itself direct-or-inverse, combined as
 * `rate = fromBase / toBase`. The reported `effectiveDate` is the older (lexicographically
 * smaller, since dates are `YYYY-MM-DD`) of the two pivot legs, and `automatic` is true only
 * when both legs are.
 *
 * Returns `null` when `fromCurrency === toCurrency` (nothing to apply) or when no path —
 * direct, inverse, or pivoted — covers the date, the same condition under which
 * `resolveRate` would throw "Missing exchange rate" for this leg.
 */
export function appliedCrossRateFor(
  state: FinanceState,
  fromCurrency: string,
  toCurrency: string,
  localDate: string,
): AppliedRate | null {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (!from || !to || from === to) return null;

  const rates = activeRates(state);

  const direct = directOrInverseApplied(rates, from, to, localDate);
  if (direct) return direct;

  const base = state.settings.baseCurrency.trim().toUpperCase();
  if (from === base || to === base) return null;

  const fromBase = directOrInverseApplied(rates, from, base, localDate);
  const toBase = directOrInverseApplied(rates, to, base, localDate);
  if (!fromBase || !toBase) return null;

  const fromBaseRate = new Decimal(fromBase.rate);
  const toBaseRate = new Decimal(toBase.rate);
  if (!toBaseRate.isFinite() || toBaseRate.lte(0)) return null;

  return {
    rate: fromBaseRate.div(toBaseRate).toSignificantDigits(20).toFixed(),
    effectiveDate:
      fromBase.effectiveDate < toBase.effectiveDate
        ? fromBase.effectiveDate
        : toBase.effectiveDate,
    automatic: fromBase.automatic && toBase.automatic,
  };
}
