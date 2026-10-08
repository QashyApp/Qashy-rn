/**
 * Orchestrates automatic exchange-rate fetching: whether it is allowed to run at all, which
 * rates it fetches, and what the UI is told about the result.
 *
 * There is no "refresh" step. Rates are fetched on demand, for exactly the currency/date pairs
 * something is about to need: the transaction and recurring forms when an account, currency or
 * date settles, the CSV preview, and `ensureRatesForPending` (today's rate for each foreign
 * account, plus every rate a recurring rule is due to use). A pair that is already stored is
 * never fetched again.
 *
 * Nothing here duplicates finance state — `deps.getState()` reads the one copy the repository
 * already holds — and nothing here fetches without first reading the device-local flag from
 * `rates-flag.ts` inside its own storage transaction, well before any `fetch` call leaves that
 * transaction. See `AGENTS.md` ("work passed to `StorageAdapter.transact` must not await
 * anything but its own transaction") for why the flag read and the network call are always two
 * separate steps here, never one.
 *
 * Every public method is failure-shaped rather than throw-shaped: a network error, a timeout, a
 * malformed response, or a storage failure is recorded on `status` and swallowed, because a rate
 * lookup must never take down app startup, a foreground resume, or a CSV import.
 */

import {
  deriveBaseRates,
  FRANKFURTER_UNSUPPORTED,
} from "@/data/exchange-rates/frankfurter";
import {
  DEFAULT_TIMEOUT_MS,
  fetchEurRates,
  RateFetchError,
  type RateFetchErrorCode,
} from "@/data/exchange-rates/rate-client";
import {
  readRatesFlag,
  writeRatesFlag,
} from "@/data/exchange-rates/rates-flag";
import type {
  FetchedRateConflict,
  FetchedRateResult,
  RateInput,
  FinanceRepository,
} from "@/data/repository";
import type { StorageAdapter } from "@/data/storage-adapter";
import type { FinanceState } from "@/domain/models";
import { addRecurrence, isLocalDate, toLocalDate } from "@/utils/date";

/** How long a failed `ensureRatesFor` pair is remembered, so a form doesn't retry it in a loop. */
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;

/** Most occurrences of one recurring rule whose rates are looked up in a single pass. */
const MAX_PENDING_OCCURRENCES_PER_RULE = 500;

/**
 * How far before the earliest wanted date a request reaches. Frankfurter only publishes on ECB
 * business days, so a weekend or holiday date is answered by the latest earlier business day;
 * a week of lead covers any realistic run of closures.
 */
const LOOKBACK_DAYS = 7;

/**
 * Multiples of the per-request timeout after which an in-flight lookup counts as stuck. A retry
 * starts a fresh lookup instead of waiting on one that old.
 */
const STALE_IN_FLIGHT_TIMEOUTS = 3;

function shiftDate(localDate: string, days: number): string {
  const ms = Date.parse(`${localDate}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** One currency that needs a rate as of one local calendar date. */
export interface RatePair {
  readonly currency: string;
  readonly localDate: string;
}

export interface EnsureRatesResult {
  /**
   * False when the request failed (offline, timeout, malformed, …) or the rates could not be
   * stored. A pair Frankfurter simply has no data for is not a failure.
   */
  readonly ok: boolean;
  readonly conflicts: readonly FetchedRateConflict[];
}

export interface EnsureRatesOptions {
  /** Also retries pairs a recent failure put in the negative cache. */
  readonly retry?: boolean;
}

/**
 * Why the last lookup failed. The three network codes come from `rate-client.ts`; `storage` means
 * the request succeeded but the rates (or the on/off flag) could not be read or written locally.
 */
export type ExchangeRateErrorCode = RateFetchErrorCode | "storage";

export interface ExchangeRateStatus {
  readonly enabled: boolean;
  readonly fetching: boolean;
  readonly lastError: ExchangeRateErrorCode | null;
  /** Reciprocal conflicts from the most recent save, so the UI can offer a manual resolution. */
  readonly conflicts: readonly FetchedRateConflict[];
  /** Currencies in use that Frankfurter does not cover, sorted. */
  readonly unsupported: readonly string[];
}

const INITIAL_STATUS: ExchangeRateStatus = {
  // Matches the flag's default, so the first render doesn't flash a "turn on" prompt before the
  // stored value is read.
  enabled: true,
  fetching: false,
  lastError: null,
  conflicts: [],
  unsupported: [],
};

export interface ExchangeRateServiceDeps {
  readonly storage: StorageAdapter;
  readonly repository: Pick<FinanceRepository, "saveFetchedRates">;
  /** Reads the one finance snapshot the repository already holds. Never duplicated here. */
  readonly getState: () => FinanceState;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Overridden in tests; on device it is `() => new Date()`. */
  readonly now?: () => Date;
  /** Overridden in tests; on device it is derived from `now()`. */
  readonly todayLocal?: () => string;
}

const sameStrings = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const normalizeCode = (value: string) => value.trim().toUpperCase();

/** Currencies this vault uses (non-archived accounts, active rules), minus the base currency. */
function usedCurrencies(state: FinanceState): Set<string> {
  const codes = new Set<string>();
  for (const account of state.accounts) {
    if (!account.archived) codes.add(normalizeCode(account.currency));
  }
  for (const rule of state.recurringRules) {
    if (!rule.active) continue;
    codes.add(normalizeCode(rule.template.currency));
    if (rule.template.foreign)
      codes.add(normalizeCode(rule.template.foreign.currency));
  }
  codes.delete(normalizeCode(state.settings.baseCurrency));
  return codes;
}

/** Currencies this vault uses that Frankfurter does not cover, sorted. */
export function unsupportedCurrencies(state: FinanceState): string[] {
  return [...usedCurrencies(state)]
    .filter((code) => FRANKFURTER_UNSUPPORTED.has(code))
    .sort();
}

/**
 * The rates this vault is about to use and may not have yet: today's rate for each live foreign
 * account (balances and net worth convert at today's rate) and, for each active recurring rule,
 * the rate on every occurrence date it is due to post up to `today` — for its account's currency
 * and for its foreign currency when the template doesn't pin a rate. Duplicates and pairs that
 * are already stored are filtered by `ensureRatesFor`, not here.
 */
export function pendingRatePairs(
  state: FinanceState,
  today: string,
): RatePair[] {
  const base = normalizeCode(state.settings.baseCurrency);
  const pairs: RatePair[] = [];
  const add = (currency: string, localDate: string) => {
    const code = normalizeCode(currency);
    if (code !== base) pairs.push({ currency: code, localDate });
  };
  for (const account of state.accounts) {
    if (!account.archived) add(account.currency, today);
  }
  for (const rule of state.recurringRules) {
    if (!rule.active) continue;
    const account = state.accounts.find(
      (item) => item.id === rule.template.accountId,
    );
    const foreign = rule.template.foreign;
    let due = rule.nextDueDate;
    for (
      let count = 0;
      due <= today && count < MAX_PENDING_OCCURRENCES_PER_RULE;
      count += 1
    ) {
      if (rule.endDate && due > rule.endDate) break;
      if (account) add(account.currency, due);
      if (foreign && !foreign.exchangeRate) add(foreign.currency, due);
      const next = addRecurrence(
        due,
        rule.unit,
        Math.max(1, rule.interval),
        rule.startDate,
      );
      if (next <= due) break;
      due = next;
    }
  }
  return pairs;
}

/** A live (non-tombstoned) row already answers this exact currency/date pair. */
function isAlreadyCovered(
  state: FinanceState,
  currency: string,
  localDate: string,
): boolean {
  const base = normalizeCode(state.settings.baseCurrency);
  return state.exchangeRates.some(
    (rate) =>
      rate.fromCurrency === currency &&
      rate.toCurrency === base &&
      rate.effectiveDate === localDate,
  );
}

/**
 * Keys the wanted set, the negative cache, and the in-flight map. Includes the base currency:
 * the same currency/date pair answers a different question under a different base.
 */
const pairKey = (base: string, currency: string, localDate: string) =>
  `${base}|${currency}|${localDate}`;

/**
 * Decides what to store for one lookup, from the derived rates Frankfurter returned.
 *
 * Each wanted pair is answered by the latest published rate on or before its date. The answer
 * is saved under the wanted date when that is exact, or when the wanted date is in the past (a
 * weekend or holiday is answered by the preceding business day, as ECB itself publishes it).
 *
 * A wanted date of today is different. Before ECB publishes (around 16:00 CET) Frankfurter only
 * has yesterday, so saving that under today would freeze yesterday's rate as today's forever,
 * since a stored row for a date is never fetched again. Instead it is stored under its real
 * source date, which keeps every "on or before" lookup correct, and today is deliberately left
 * unanswered so the next pass asks again. Such a pair still counts as `answered`, so it is not
 * negative-cached and is retried on a later pass rather than after the cache window.
 *
 * Returns `answered`: the wanted keys that got a rate or were deliberately deferred. Every other
 * wanted key had no data on or before its date and is negative-cached.
 */
function planSaves(
  derived: readonly RateInput[],
  today: string,
  wanted: ReadonlyMap<string, RatePair>,
): { rates: RateInput[]; answered: Set<string> } {
  const latestByCurrency = new Map<string, RateInput[]>();
  for (const rate of derived) {
    const list = latestByCurrency.get(rate.fromCurrency) ?? [];
    list.push(rate);
    latestByCurrency.set(rate.fromCurrency, list);
  }
  // Keyed by currency and stored date, so two wanted dates answered by the same source row
  // produce one row, not a duplicate in a single batch.
  const rates = new Map<string, RateInput>();
  const answered = new Set<string>();
  for (const [key, entry] of wanted) {
    let best: RateInput | undefined;
    for (const rate of latestByCurrency.get(entry.currency) ?? []) {
      if (
        rate.effectiveDate <= entry.localDate &&
        (!best || rate.effectiveDate > best.effectiveDate)
      ) {
        best = rate;
      }
    }
    if (!best) continue; // No data on or before this date: negative-cached by the caller.
    answered.add(key);
    // `entry.localDate` is never later than `today` (ensureRatesFor clamps it), so this is a
    // past date unless it is today itself.
    const storedDate =
      best.effectiveDate === entry.localDate || entry.localDate < today
        ? entry.localDate
        : best.effectiveDate;
    const row: RateInput = { ...best, effectiveDate: storedDate };
    rates.set(`${row.fromCurrency}|${storedDate}`, row);
  }
  return { rates: [...rates.values()], answered };
}

interface InFlight {
  readonly startedAt: number;
  readonly promise: Promise<EnsureRatesResult>;
}

export class ExchangeRateService {
  private status: ExchangeRateStatus = INITIAL_STATUS;
  private readonly listeners = new Set<() => void>();
  private readonly negativeCache = new Map<string, number>();
  private readonly inFlight = new Map<string, InFlight>();
  /** Lookups currently running; `fetching` is true while any is. */
  private activeFetches = 0;

  constructor(private readonly deps: ExchangeRateServiceDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private todayLocal(): string {
    if (this.deps.todayLocal) return this.deps.todayLocal();
    return toLocalDate(this.now());
  }

  private setStatus(patch: Partial<ExchangeRateStatus>): void {
    const next = { ...this.status, ...patch };
    if (
      next.enabled === this.status.enabled &&
      next.fetching === this.status.fetching &&
      next.lastError === this.status.lastError &&
      next.conflicts === this.status.conflicts &&
      sameStrings(next.unsupported, this.status.unsupported)
    ) {
      return;
    }
    this.status = next;
    this.listeners.forEach((listener) => listener());
  }

  /** Usable directly as `useSyncExternalStore`'s snapshot getter. */
  getStatus = (): ExchangeRateStatus => this.status;

  /** Usable directly as `useSyncExternalStore`'s subscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private isNegativeCached(key: string): boolean {
    const at = this.negativeCache.get(key);
    if (at === undefined) return false;
    if (this.now().getTime() - at > NEGATIVE_CACHE_MS) {
      this.negativeCache.delete(key);
      return false;
    }
    return true;
  }

  /** Writes the on/off flag. Turning it on immediately looks up whatever is pending. Never throws. */
  setEnabled = async (on: boolean): Promise<void> => {
    try {
      await this.deps.storage.transact((tx) =>
        writeRatesFlag(tx, { enabled: on }),
      );
    } catch {
      // The flag did not change, so the reported state must not change either.
      this.setStatus({ lastError: "storage" });
      return;
    }
    this.setStatus({ enabled: on });
    if (on) await this.ensureRatesForPending({ retry: true });
  };

  /**
   * Looks up the rates the vault is about to use (see `pendingRatePairs`). Called on startup, on
   * foreground resume and before recurring generation, so a rule that posts on its own never
   * finds its rate missing, and again when automatic rates are turned on.
   */
  ensureRatesForPending = (
    options: EnsureRatesOptions = {},
  ): Promise<EnsureRatesResult> =>
    this.ensureRatesFor(
      pendingRatePairs(this.deps.getState(), this.todayLocal()),
      options,
    );

  /**
   * Fills in whatever rates `pairs` are missing, with one range request for the lot.
   *
   * A no-op — no fetch, nothing cached — when the flag is off, so this is always safe to call
   * from the transaction form or CSV preview without checking the flag first. Never throws.
   */
  ensureRatesFor = async (
    pairs: readonly RatePair[],
    options: EnsureRatesOptions = {},
  ): Promise<EnsureRatesResult> => {
    let base: string;
    let today: string;
    const wanted = new Map<string, RatePair>();
    try {
      const state = this.deps.getState();
      base = normalizeCode(state.settings.baseCurrency);
      today = this.todayLocal();
      this.setStatus({ unsupported: unsupportedCurrencies(state) });

      const flag = await this.deps.storage.transact((tx) => readRatesFlag(tx));
      this.setStatus({ enabled: flag.enabled });
      if (!flag.enabled) return { ok: true, conflicts: [] };

      for (const pair of pairs) {
        const currency = normalizeCode(pair.currency);
        if (currency === base || FRANKFURTER_UNSUPPORTED.has(currency))
          continue;
        if (!isLocalDate(pair.localDate)) continue;
        const localDate = pair.localDate > today ? today : pair.localDate;
        if (isAlreadyCovered(state, currency, localDate)) continue;
        const key = pairKey(base, currency, localDate);
        if (!options.retry && this.isNegativeCached(key)) continue;
        wanted.set(key, { currency, localDate });
      }
    } catch {
      // Reading the flag or the local snapshot failed before any request was made.
      this.setStatus({ lastError: "storage" });
      return { ok: false, conflicts: [] };
    }
    if (!wanted.size) return { ok: true, conflicts: [] };

    const dedupeKey = [...wanted.keys()].sort().join(",");
    const nowMs = this.now().getTime();
    const existing = this.inFlight.get(dedupeKey);
    // A plain call joins a lookup already running. A retry joins it only while it is young: a
    // lookup older than a few timeouts is stuck, and a retry must be able to get past it.
    if (
      existing &&
      (!options.retry || nowMs - existing.startedAt < this.staleInFlightMs())
    ) {
      return existing.promise;
    }

    const promise = this.runLookup(base, today, wanted).finally(() => {
      // Only clear the record this lookup created: a newer retry may have replaced it.
      if (this.inFlight.get(dedupeKey)?.promise === promise) {
        this.inFlight.delete(dedupeKey);
      }
    });
    this.inFlight.set(dedupeKey, { startedAt: nowMs, promise });
    return promise;
  };

  private staleInFlightMs(): number {
    return (
      STALE_IN_FLIGHT_TIMEOUTS * (this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    );
  }

  private async runLookup(
    base: string,
    today: string,
    wanted: ReadonlyMap<string, RatePair>,
  ): Promise<EnsureRatesResult> {
    this.activeFetches += 1;
    this.setStatus({ fetching: true });
    try {
      return await this.fetchAndSave(base, today, wanted);
    } finally {
      this.activeFetches -= 1;
      this.setStatus({ fetching: this.activeFetches > 0 });
    }
  }

  private async fetchAndSave(
    base: string,
    today: string,
    wanted: ReadonlyMap<string, RatePair>,
  ): Promise<EnsureRatesResult> {
    const entries = [...wanted.values()];
    const dates = entries.map((entry) => entry.localDate).sort();
    const currencies = [...new Set(entries.map((entry) => entry.currency))];
    const minDate = dates[0]!;
    const maxDate = dates[dates.length - 1]!;

    let rates: RateInput[];
    let answered: Set<string>;
    try {
      const quotes = [...new Set([...currencies, base])];
      const rows = await fetchEurRates(
        { fetch: this.deps.fetch, timeoutMs: this.deps.timeoutMs },
        { quotes, from: shiftDate(minDate, -LOOKBACK_DAYS), to: maxDate },
      );
      const derived = deriveBaseRates(rows, base, currencies);
      ({ rates, answered } = planSaves(derived, today, wanted));
    } catch (error) {
      // Only a request or validation failure is negative-cached: asking again straight away
      // would hit the same failure.
      const at = this.now().getTime();
      for (const key of wanted.keys()) this.negativeCache.set(key, at);
      this.setStatus({
        lastError: error instanceof RateFetchError ? error.code : "malformed",
      });
      return { ok: false, conflicts: [] };
    }

    let result: FetchedRateResult;
    try {
      result = rates.length
        ? await this.deps.repository.saveFetchedRates(rates)
        : { written: 0, skippedManual: 0, conflicts: [] };
    } catch {
      // A local storage failure says nothing about Frankfurter, so no pair is negative-cached.
      this.setStatus({ lastError: "storage" });
      return { ok: false, conflicts: [] };
    }

    // A pair Frankfurter had no data for would otherwise be asked for again on every call.
    const at = this.now().getTime();
    for (const key of wanted.keys()) {
      if (!answered.has(key)) this.negativeCache.set(key, at);
    }
    this.setStatus({ lastError: null, conflicts: result.conflicts });
    return { ok: true, conflicts: result.conflicts };
  }
}

export function createExchangeRateService(
  deps: ExchangeRateServiceDeps,
): ExchangeRateService {
  return new ExchangeRateService(deps);
}

// Re-exported so callers building `RateInput[]` by hand (tests, mostly) don't need a second
// import just for the type.
export type { RateInput };
