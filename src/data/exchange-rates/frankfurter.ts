/**
 * Pure helpers for the Frankfurter exchange-rate API (`https://api.frankfurter.dev`).
 *
 * Nothing here touches the network — `rate-client.ts` does that — so every case is a plain
 * function of its input and is exercised without a fetch mock. The one policy decision baked
 * in here is the EUR pivot: every request is `base=EUR`, and every derived rate is computed
 * from two EUR-pivot legs read off the *same day's* response, because EUR→X never drops below
 * roughly 0.35 for any fiat currency Qashy supports, which keeps five significant digits on
 * every leg. Requesting a pair directly instead would sometimes ask for a base whose quote
 * currency is worth thousands of times less, and Frankfurter only carries ~5 significant
 * figures per figure it returns.
 */

import { Decimal } from 'decimal.js';

import type { RateInput } from '@/data/repository';
import { isLocalDate } from '@/utils/date';
import { z } from '@/utils/zod';

const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v2/rates';

/** Every request pivots through EUR; see the file header for why. */
const PIVOT = 'EUR';

/**
 * ISO codes Qashy accepts as an account currency that Frankfurter never returns.
 *
 * Verified live against the API (2026-09-25): each is silently omitted from a `quotes`
 * response rather than causing an error, so a currency landing here has to be discovered by
 * probing, not inferred from an error code. `rate-service.ts` excludes these from the set of
 * currencies it ever asks for, and the "needs a manual rate" UI lists them as unsupported.
 */
export const FRANKFURTER_UNSUPPORTED: ReadonlySet<string> = new Set([
  'CUC',
  'HRK',
  'SLL',
  'XSU',
  'ZWL',
]);

export type RatesUrlParams =
  | { readonly quotes: readonly string[]; readonly date?: string }
  | { readonly quotes: readonly string[]; readonly from: string; readonly to: string };

/**
 * Builds a `/v2/rates` URL for a EUR-pivoted request.
 *
 * `quotes` is sorted and de-duplicated (and EUR is dropped, since asking Frankfurter for EUR
 * as a quote of itself is meaningless) so two callers wanting the same currencies in a
 * different order produce byte-identical URLs. Omit `date` for "latest"; pass `from`/`to` for
 * a range. Built with plain string interpolation rather than `URLSearchParams` — every value
 * that reaches here is already a validated three-letter code or a `YYYY-MM-DD` date, so there
 * is nothing to percent-encode, and the request stays exactly what it looks like: currency
 * codes and dates, nothing else.
 */
export function buildRatesUrl(params: RatesUrlParams): string {
  const quotes = [...new Set(params.quotes.map((code) => code.trim().toUpperCase()))]
    .filter((code) => code !== PIVOT)
    .sort();
  const query = [`base=${PIVOT}`];
  if (quotes.length) query.push(`quotes=${quotes.join(',')}`);
  if ('from' in params) {
    query.push(`from=${params.from}`, `to=${params.to}`);
  } else if (params.date) {
    query.push(`date=${params.date}`);
  }
  return `${FRANKFURTER_BASE_URL}?${query.join('&')}`;
}

const rateRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isLocalDate, 'Frankfurter returned a malformed date.'),
  base: z.literal(PIVOT),
  quote: z.string().regex(/^[A-Z]{3}$/, 'Frankfurter returned a malformed quote code.'),
  // `rate` is re-parsed through `Decimal(String(n))` in `deriveBaseRates` — JSON's own number
  // type is enough to reject NaN/Infinity/non-positive here, but not enough precision to
  // trust for the arithmetic, since small rates come back in exponent form.
  rate: z.number().finite().positive(),
});

const ratesResponseSchema = z.array(rateRowSchema);

export type FrankfurterRow = z.infer<typeof rateRowSchema>;

/**
 * Validates a decoded JSON response body against the shape Frankfurter promises.
 *
 * Rejects the *entire* response — throws rather than filtering — on any row with the wrong
 * base, a malformed date, a non-finite or non-positive rate, or a quote currency this call
 * never asked for. A response that fails partial validation is a response from a host that is
 * not behaving like Frankfurter, and no subset of it is safer to trust than the rest.
 */
export function parseRatesResponse(
  json: unknown,
  requestedQuotes: readonly string[],
): FrankfurterRow[] {
  const rows = ratesResponseSchema.parse(json);
  const requested = new Set(requestedQuotes.map((code) => code.trim().toUpperCase()));
  for (const row of rows) {
    if (!requested.has(row.quote)) {
      throw new Error(`Frankfurter returned a quote currency that was not requested: ${row.quote}.`);
    }
  }
  return rows;
}

/** One EUR-pivot leg for one calendar day: `1 EUR = rate QUOTE`. */
function makeRate(fromCurrency: string, toCurrency: string, effectiveDate: string, rate: Decimal): RateInput {
  return {
    fromCurrency,
    toCurrency,
    effectiveDate,
    // `toFixed()`, not `toString()`: decimal.js switches to exponential notation below 1e-7,
    // which real pairs (e.g. a JPY base against a strong quote) can reach, and the repository's
    // `normalizeRate` stores rates as plain decimal strings.
    rate: rate.toSignificantDigits(10).toFixed(),
  };
}

/**
 * Derives `1 FOREIGN = r BASE` for every `foreignCurrencies` entry that has an EUR-pivot leg
 * on a given day, from the raw rows `parseRatesResponse` returned (possibly spanning several
 * dates, when `rows` is the concatenation of chunked range requests).
 *
 * Only currencies with a leg on the *same day* as the base's own leg produce a rate — a
 * currency Frankfurter omitted for that date (unsupported, or the row simply was not in the
 * response) is skipped rather than guessed at. The three cases from the file header:
 *   - `base == EUR`:      `r = 1 / eur[F]`
 *   - `F == EUR`:         `r = eur[B]`
 *   - otherwise:          `r = eur[B] / eur[F]`
 */
export function deriveBaseRates(
  rows: readonly FrankfurterRow[],
  baseCurrency: string,
  foreignCurrencies: readonly string[],
): RateInput[] {
  const base = baseCurrency.trim().toUpperCase();
  const foreign = [...new Set(foreignCurrencies.map((code) => code.trim().toUpperCase()))]
    .filter((code) => code !== base);
  if (!foreign.length) return [];

  // Grouped by date, not flattened, so a pair is only ever derived from two legs read off the
  // same day — mixing a range request's Tuesday EUR→USD with its Wednesday EUR→VND would
  // produce a rate that describes a day that never happened.
  const byDate = new Map<string, Map<string, Decimal>>();
  for (const row of rows) {
    const eur = new Decimal(String(row.rate));
    if (!eur.isFinite() || !eur.isPositive()) continue;
    const perDate = byDate.get(row.date) ?? new Map<string, Decimal>();
    perDate.set(row.quote, eur);
    byDate.set(row.date, perDate);
  }

  const results: RateInput[] = [];
  for (const [effectiveDate, eur] of byDate) {
    const eurToBase = base === PIVOT ? undefined : eur.get(base);
    for (const code of foreign) {
      if (code === PIVOT) {
        // 1 EUR = eur[base] BASE. Only meaningful when the base itself is not EUR.
        if (!eurToBase) continue;
        results.push(makeRate(code, base, effectiveDate, eurToBase));
        continue;
      }
      const eurToForeign = eur.get(code);
      if (!eurToForeign) continue; // No leg for this currency on this day: skip, don't guess.
      const rate = base === PIVOT ? new Decimal(1).div(eurToForeign) : eurToBase?.div(eurToForeign);
      if (!rate) continue; // Missing base leg for this date: skip rather than guess.
      results.push(makeRate(code, base, effectiveDate, rate));
    }
  }
  return results;
}
