import { Decimal } from "decimal.js";

import type { FinanceContext } from "@/data/finance/context";
import { active, withEntity } from "@/data/finance/records";
import {
  assertDate,
  normalizeCurrency,
  normalizeRate,
} from "@/data/finance/validation";
import type { FetchedRateConflict, RateInput } from "@/data/repository";
import type {
  ExchangeRate,
  TransactionRecord,
  TransactionStatus,
} from "@/domain/models";
import { fetchedRateId } from "@/utils/deterministic-id";
import { createEntity, updateEntity } from "@/utils/entity";
import { convertMinor, currencyDigits } from "@/utils/money";

// How far a manually entered rate may sit from the reciprocal of an existing
// opposite-direction rate before the pair is treated as contradictory (2%).
const RECIPROCAL_RATE_TOLERANCE = 0.02;

/**
 * Thrown when no rate for a pair and date can be resolved. Callers that treat a missing rate as
 * transient (recurring generation, the dashboard, `hasRate`) match on this class, not the message.
 */
export class MissingExchangeRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingExchangeRateError";
  }
}

/**
 * Renders a Decimal as a plain decimal string. `toString` switches to exponent form below 1e-7
 * (`8.9e-9`), which is not a decimal string the rate fields or the form input accept.
 */
export function plainDecimal(value: Decimal) {
  return value.toSignificantDigits(20).toFixed();
}

export function resolveRate(
  ctx: FinanceContext,
  fromValue: string,
  toValue: string,
  localDate: string,
  exchangeRates = ctx.state.exchangeRates,
) {
  const fromCurrency = normalizeCurrency(fromValue);
  const toCurrency = normalizeCurrency(toValue);
  assertDate(localDate);
  if (fromCurrency === toCurrency) return "1";
  const direct = directOrInverseRate(
    fromCurrency,
    toCurrency,
    localDate,
    exchangeRates,
  );
  if (direct) return direct;
  const baseCurrency = ctx.state.settings.baseCurrency;
  if (fromCurrency !== baseCurrency && toCurrency !== baseCurrency) {
    const fromBase = directOrInverseRate(
      fromCurrency,
      baseCurrency,
      localDate,
      exchangeRates,
    );
    const toBase = directOrInverseRate(
      toCurrency,
      baseCurrency,
      localDate,
      exchangeRates,
    );
    if (fromBase && toBase)
      return plainDecimal(new Decimal(fromBase).div(toBase));
  }
  if (fromCurrency === baseCurrency) {
    const toBase = directOrInverseRate(
      toCurrency,
      baseCurrency,
      localDate,
      exchangeRates,
    );
    if (toBase) return plainDecimal(new Decimal(1).div(toBase));
  }
  throw new MissingExchangeRateError(
    `Missing exchange rate for ${fromCurrency} → ${toCurrency} on ${localDate}.`,
  );
}

export function directOrInverseRate(
  fromCurrency: string,
  toCurrency: string,
  localDate: string,
  exchangeRates: ExchangeRate[],
) {
  const direct = latestRate(fromCurrency, toCurrency, localDate, exchangeRates);
  if (direct) return normalizeRate(direct.rate);
  const inverse = latestRate(
    toCurrency,
    fromCurrency,
    localDate,
    exchangeRates,
  );
  if (!inverse) return null;
  return plainDecimal(new Decimal(1).div(normalizeRate(inverse.rate)));
}

export function latestRate(
  fromCurrency: string,
  toCurrency: string,
  localDate: string,
  exchangeRates: ExchangeRate[],
) {
  // One scan for the newest row (by date, then update time; the first wins a tie) instead of
  // sorting every match: this runs for each row of a CSV import.
  let latest: ExchangeRate | undefined;
  for (const item of exchangeRates) {
    if (
      item.deletedAt ||
      item.fromCurrency !== fromCurrency ||
      item.toCurrency !== toCurrency ||
      item.effectiveDate > localDate
    )
      continue;
    if (
      !latest ||
      item.effectiveDate > latest.effectiveDate ||
      (item.effectiveDate === latest.effectiveDate &&
        item.updatedAt > latest.updatedAt)
    )
      latest = item;
  }
  return latest;
}

export function hasRate(
  ctx: FinanceContext,
  fromValue: string,
  toValue: string,
  localDate: string,
) {
  try {
    resolveRate(ctx, fromValue, toValue, localDate);
    return true;
  } catch (reason) {
    // Only a genuinely missing rate reads as "no rate"; anything else is a real failure.
    if (reason instanceof MissingExchangeRateError) return false;
    throw reason;
  }
}

/**
 * Runs a rate lookup that may leave an upcoming transaction unpriced. Only a missing rate on
 * an upcoming row is swallowed (returning `null`); a posted row still needs its rate.
 */
export function rateOrNullWhileUpcoming(
  status: TransactionStatus,
  lookup: () => string | null,
): string | null {
  try {
    return lookup();
  } catch (reason) {
    if (status === "upcoming" && reason instanceof MissingExchangeRateError)
      return null;
    throw reason;
  }
}

/**
 * `resolveRate` for a transfer's source leg, falling back to the rate implied by the typed
 * destination amount when that amount is already denominated in the base currency.
 */
export function resolveTransferAwareRate(
  ctx: FinanceContext,
  fromCurrency: string,
  localDate: string,
  amountMinor: number,
  baseAmountMinor: number | null,
) {
  try {
    return resolveRate(
      ctx,
      fromCurrency,
      ctx.state.settings.baseCurrency,
      localDate,
    );
  } catch (reason) {
    if (baseAmountMinor === null || amountMinor <= 0 || baseAmountMinor <= 0)
      throw reason;
    const locale = ctx.formatLocale;
    return new Decimal(baseAmountMinor)
      .div(
        new Decimal(10).pow(
          currencyDigits(ctx.state.settings.baseCurrency, locale),
        ),
      )
      .div(
        new Decimal(amountMinor).div(
          new Decimal(10).pow(currencyDigits(fromCurrency, locale)),
        ),
      )
      .toSignificantDigits(20)
      .toFixed();
  }
}

// A pair may be entered in either direction. If both directions exist and they
// disagree, a transfer converts out through one and back in through the other,
// so the two legs no longer describe the same amount and the difference is
// conjured into (or out of) the base-currency totals. Reject the contradiction
// at entry rather than letting it silently corrupt every later conversion.
//
// Split into a non-throwing checker and this throwing wrapper because
// `saveFetchedRatesNow` needs the same drift logic but cannot let one stale manual
// row on the opposite side throw an entire batch away — it reports the row as a
// conflict and keeps going instead.
export function assertReciprocalRate(
  ctx: FinanceContext,
  fromCurrency: string,
  toCurrency: string,
  rate: string,
  effectiveDate: string,
  id?: string,
) {
  const reciprocal = findReciprocalConflict(
    ctx,
    fromCurrency,
    toCurrency,
    rate,
    effectiveDate,
    id,
  );
  if (!reciprocal) return;
  const implied = new Decimal(1).div(normalizeRate(reciprocal.rate));
  throw new Error(
    `This contradicts the existing ${toCurrency} → ${fromCurrency} rate of ${reciprocal.rate}, which implies ${implied.toSignificantDigits(8)}. Update or remove that rate first.`,
  );
}

/** The reciprocal row that `rate` contradicts beyond tolerance, or `undefined` if none does. */
export function findReciprocalConflict(
  ctx: FinanceContext,
  fromCurrency: string,
  toCurrency: string,
  rate: string,
  effectiveDate: string,
  id?: string,
  exchangeRates = ctx.state.exchangeRates,
): ExchangeRate | undefined {
  const rates = active(exchangeRates).filter((item) => item.id !== id);
  const nextDirectDate = rates
    .filter(
      (item) =>
        item.fromCurrency === fromCurrency &&
        item.toCurrency === toCurrency &&
        item.effectiveDate > effectiveDate,
    )
    .sort((a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate),
    )[0]?.effectiveDate;
  const opposite = rates
    .filter(
      (item) =>
        item.fromCurrency === toCurrency && item.toCurrency === fromCurrency,
    )
    .sort(
      (a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate) ||
        a.updatedAt.localeCompare(b.updatedAt),
    );
  const effectiveReciprocal = opposite
    .filter((item) => item.effectiveDate <= effectiveDate)
    .at(-1);
  const laterReciprocals = opposite.filter(
    (item) =>
      item.effectiveDate > effectiveDate &&
      (!nextDirectDate || item.effectiveDate < nextDirectDate),
  );
  const reciprocals = [effectiveReciprocal, ...laterReciprocals].filter(
    (item): item is ExchangeRate => Boolean(item),
  );
  const entered = new Decimal(rate);
  for (const reciprocal of reciprocals) {
    const implied = new Decimal(1).div(normalizeRate(reciprocal.rate));
    // Manually entered rates carry real spread and rounding, so compare with a
    // tolerance instead of demanding an exact reciprocal.
    const drift = entered.minus(implied).abs().div(implied);
    if (drift.lessThanOrEqualTo(RECIPROCAL_RATE_TOLERANCE)) continue;
    return reciprocal;
  }
  return undefined;
}

/**
 * The base-currency amount of a posted transaction. A posted row always carries its snapshot, so
 * a null here means corrupt state, and it fails closed rather than summing as zero.
 */
export function postedBaseMinor(transaction: TransactionRecord): number {
  if (transaction.baseAmountMinor === null)
    throw new Error("Posted transactions need an exchange rate.");
  return transaction.baseAmountMinor;
}

/**
 * The snapshot an unpriced row (`exchangeRate` or `baseAmountMinor` is null, or a transfer's
 * destination base is null) gets when it is paid. The rate is the latest stored one on or before
 * `pricingDate`; `localDate` never changes. Returns `null` when nothing needs pricing. Throws
 * `MissingExchangeRateError`, with nothing written, when a needed rate is not stored yet.
 */
export function snapshotForPricing(
  ctx: FinanceContext,
  transaction: TransactionRecord,
  pricingDate: string,
): {
  exchangeRate: string;
  baseAmountMinor: number;
  destinationBaseAmountMinor: number | null;
} | null {
  const base = ctx.state.settings.baseCurrency;
  const locale = ctx.formatLocale;
  const accountPriced =
    transaction.exchangeRate !== null && transaction.baseAmountMinor !== null;
  const destinationNeedsPricing =
    transaction.kind === "transfer" &&
    transaction.destinationCurrency !== null &&
    transaction.destinationAmountMinor !== null &&
    transaction.destinationBaseAmountMinor === null;
  if (accountPriced && !destinationNeedsPricing) return null;
  let exchangeRate = transaction.exchangeRate;
  let baseAmountMinor = transaction.baseAmountMinor;
  if (!accountPriced) {
    const rate =
      transaction.currency === base
        ? "1"
        : resolveRate(ctx, transaction.currency, base, pricingDate);
    exchangeRate = normalizeRate(rate);
    baseAmountMinor = convertMinor(
      transaction.amountMinor,
      transaction.currency,
      base,
      rate,
      locale,
    );
    if (transaction.amountMinor > 0 && baseAmountMinor <= 0) {
      throw new Error(
        `This amount converts to less than the smallest unit of ${base}. Enter a larger amount or check the exchange rate.`,
      );
    }
  }
  let destinationBaseAmountMinor = transaction.destinationBaseAmountMinor;
  if (destinationNeedsPricing) {
    const destinationCurrency = transaction.destinationCurrency!;
    const destinationAmountMinor = transaction.destinationAmountMinor!;
    if (destinationCurrency === base) {
      destinationBaseAmountMinor = destinationAmountMinor;
    } else if (destinationCurrency === transaction.currency) {
      destinationBaseAmountMinor = baseAmountMinor!;
    } else {
      destinationBaseAmountMinor = convertMinor(
        destinationAmountMinor,
        destinationCurrency,
        base,
        resolveRate(ctx, destinationCurrency, base, pricingDate),
        locale,
      );
    }
  }
  return {
    exchangeRate: exchangeRate!,
    baseAmountMinor: baseAmountMinor!,
    destinationBaseAmountMinor,
  };
}

/**
 * The row as a posted transaction, with its snapshot filled in when it was unpriced. Returns
 * `null` when a needed rate is not stored yet, leaving the row upcoming, unless `rethrowMissing`.
 */
export function postedWithSnapshot(
  ctx: FinanceContext,
  transaction: TransactionRecord,
  pricingDate: string,
  rethrowMissing = false,
): TransactionRecord | null {
  let snapshot: ReturnType<typeof snapshotForPricing>;
  try {
    snapshot = snapshotForPricing(ctx, transaction, pricingDate);
  } catch (reason) {
    if (!rethrowMissing && reason instanceof MissingExchangeRateError)
      return null;
    throw reason;
  }
  return updateEntity(transaction, { status: "posted", ...(snapshot ?? {}) });
}

/**
 * Whether posting `transaction` on `pricingDate` would succeed right now: the same pricing check
 * auto-post uses (`postedWithSnapshot`), so a count of "what would post" agrees with generation.
 * An unpriced occurrence whose rate is not stored yet, or one that cannot be priced at all, stays
 * upcoming. Pure: it reads `ctx.state` and changes nothing.
 */
export function canPostNow(
  ctx: FinanceContext,
  transaction: TransactionRecord,
  pricingDate: string,
): boolean {
  try {
    return postedWithSnapshot(ctx, transaction, pricingDate) !== null;
  } catch {
    return false;
  }
}

/**
 * Validates every fetched rate before any state is touched — a caller bug (a bad currency code, a
 * malformed date, a rate that is not a positive number, or a pair converting into something
 * other than the base currency) fails the whole call rather than silently dropping the row
 * later where it would look like a conflict.
 */
export function normalizeFetchedRates(
  ctx: FinanceContext,
  rates: readonly RateInput[],
) {
  const normalized = rates.map((input) => {
    const fromCurrency = normalizeCurrency(input.fromCurrency);
    const toCurrency = normalizeCurrency(input.toCurrency);
    if (fromCurrency === toCurrency)
      throw new Error("Exchange-rate currencies must be different.");
    if (toCurrency !== ctx.state.settings.baseCurrency) {
      throw new Error("A fetched rate must convert into the base currency.");
    }
    assertDate(input.effectiveDate);
    return {
      fromCurrency,
      toCurrency,
      effectiveDate: input.effectiveDate,
      rate: normalizeRate(input.rate),
    };
  });
  return normalized;
}

/**
 * Decides which of the normalized fetched rates to write: skips a pair a manual rate already
 * holds, a rate the user deleted and one that did not move, and reports the ones that contradict
 * an opposite-direction rate. `storedById` holds every stored row, tombstones included. Writes
 * nothing.
 */
export function planFetchedRates(
  ctx: FinanceContext,
  normalized: ReturnType<typeof normalizeFetchedRates>,
  storedById: ReadonlyMap<string, ExchangeRate>,
) {
  // Builds up the working set as rows are accepted, so two rows in the same batch — and the
  // reciprocal check for a later row — see rows this batch already decided to write, not just
  // what was on disk when the call started. Tombstone-free throughout, like `ctx.state`.
  let exchangeRates = ctx.state.exchangeRates;
  const written: ExchangeRate[] = [];
  const conflicts: FetchedRateConflict[] = [];
  let skippedManual = 0;

  // One fetched row per pair and date. Two rows for the same key would otherwise both be
  // counted, and the second would write a conflicting duplicate of the first. The later row
  // wins, so the outcome does not depend on anything but the batch itself.
  const latestByKey = new Map<string, (typeof normalized)[number]>();
  for (const input of normalized) {
    latestByKey.set(
      fetchedRateId(input.fromCurrency, input.toCurrency, input.effectiveDate),
      input,
    );
  }

  for (const input of latestByKey.values()) {
    const id = fetchedRateId(
      input.fromCurrency,
      input.toCurrency,
      input.effectiveDate,
    );
    const liveSameKey = exchangeRates.find(
      (item) =>
        item.id !== id &&
        item.fromCurrency === input.fromCurrency &&
        item.toCurrency === input.toCurrency &&
        item.effectiveDate === input.effectiveDate,
    );
    if (liveSameKey) {
      // A manual row already holds this exact key. Writing our id alongside it would leave
      // two live rows for the same (from, to, date), which the repair pass would then have
      // to notice and tombstone — and it would pick one every time this refetches, forever.
      // The manual row wins instead.
      skippedManual += 1;
      continue;
    }
    const existingById = storedById.get(id);
    if (existingById?.deletedAt) {
      // The user deleted this fetched rate. Resurrecting it fights both the repair pass and
      // the user's own action.
      continue;
    }
    if (existingById && normalizeRate(existingById.rate) === input.rate) {
      // No-op: an unattended "latest" re-fetch that did not move. Skip so it does not bump a
      // revision or emit a sync op for a value that did not change.
      continue;
    }
    const reciprocal = findReciprocalConflict(
      ctx,
      input.fromCurrency,
      input.toCurrency,
      input.rate,
      input.effectiveDate,
      existingById?.id,
      exchangeRates,
    );
    if (reciprocal) {
      // Reported, not thrown: one stale manual row on the opposite side must not block every
      // other currency this batch would otherwise have written.
      conflicts.push({
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        effectiveDate: input.effectiveDate,
        existingRate: reciprocal.rate,
      });
      continue;
    }
    const entity = existingById
      ? updateEntity(existingById, { rate: input.rate })
      : (createEntity({ id, ...input }) as ExchangeRate);
    exchangeRates = withEntity(exchangeRates, entity);
    written.push(entity);
  }
  return { exchangeRates, written, conflicts, skippedManual };
}
