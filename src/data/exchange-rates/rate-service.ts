/**
 * Orchestrates automatic exchange-rate fetching: whether it is allowed to run at all, what it
 * fetches, and what the UI is told about the result.
 *
 * Nothing here duplicates finance state — `deps.getState()` reads the one copy the repository
 * already holds — and nothing here fetches without first reading the device-local opt-in flag
 * from `rates-flag.ts` inside its own storage transaction, well before any `fetch` call leaves
 * that transaction. See `AGENTS.md` ("work passed to `StorageAdapter.transact` must not await
 * anything but its own transaction") for why the flag read and the network call are always two
 * separate steps here, never one.
 *
 * Every public method is failure-shaped rather than throw-shaped: a network error, a timeout, or
 * a malformed response is recorded on `status` and swallowed, because a background rate refresh
 * must never take down app startup, a foreground resume, or a CSV import.
 */

import {
  deriveBaseRates,
  FRANKFURTER_UNSUPPORTED,
} from '@/data/exchange-rates/frankfurter';
import { fetchEurRates, RateFetchError, type RateFetchErrorCode } from '@/data/exchange-rates/rate-client';
import { readRatesFlag, writeRatesFlag } from '@/data/exchange-rates/rates-flag';
import type { FetchedRateConflict, FetchedRateResult, RateInput, FinanceRepository } from '@/data/repository';
import type { StorageAdapter } from '@/data/storage-adapter';
import type { FinanceState } from '@/domain/models';
import { isLocalDate, toLocalDate } from '@/utils/date';

/** How often `refreshLatest` is willing to hit the network on its own, absent `force`. */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** How long a failed `ensureRatesFor` pair is remembered, so a form doesn't retry it in a loop. */
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;

/** One currency that needs a rate as of one local calendar date. */
export interface RatePair {
  readonly currency: string;
  readonly localDate: string;
}

export interface EnsureRatesResult {
  /** False only when the request itself failed (offline, timeout, malformed, …). */
  readonly ok: boolean;
  readonly conflicts: readonly FetchedRateConflict[];
}

export interface ExchangeRateStatus {
  readonly enabled: boolean;
  readonly fetching: boolean;
  /** ISO timestamp of the last completed refresh, successful or not. */
  readonly lastRefreshAt: string | null;
  readonly lastError: RateFetchErrorCode | null;
  /** Reciprocal conflicts from the most recent save, so the UI can offer a manual resolution. */
  readonly conflicts: readonly FetchedRateConflict[];
  /** Currencies in use that Frankfurter does not cover, sorted. */
  readonly unsupported: readonly string[];
}

const INITIAL_STATUS: ExchangeRateStatus = {
  enabled: false,
  fetching: false,
  lastRefreshAt: null,
  lastError: null,
  conflicts: [],
  unsupported: [],
};

export interface ExchangeRateServiceDeps {
  readonly storage: StorageAdapter;
  readonly repository: Pick<FinanceRepository, 'saveFetchedRates'>;
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

/**
 * Currencies this vault actually needs a rate for: every non-archived account's currency, plus
 * every active recurring rule's template currency, minus the base currency (nothing converts
 * into itself) and minus whatever Frankfurter does not cover (`FRANKFURTER_UNSUPPORTED` — those
 * are surfaced separately, as `unsupportedCurrencies`, for a manual-rate prompt). Sorted, so two
 * callers building the same request produce the same `quotes` list.
 */
export function neededCurrencies(state: FinanceState): string[] {
  const base = normalizeCode(state.settings.baseCurrency);
  const codes = new Set<string>();
  for (const account of state.accounts) {
    if (!account.archived) codes.add(normalizeCode(account.currency));
  }
  for (const rule of state.recurringRules) {
    if (rule.active) codes.add(normalizeCode(rule.template.currency));
  }
  codes.delete(base);
  for (const code of FRANKFURTER_UNSUPPORTED) codes.delete(code);
  return [...codes].sort();
}

/** Currencies this vault uses that Frankfurter does not cover, sorted. */
export function unsupportedCurrencies(state: FinanceState): string[] {
  const base = normalizeCode(state.settings.baseCurrency);
  const codes = new Set<string>();
  for (const account of state.accounts) {
    if (!account.archived) codes.add(normalizeCode(account.currency));
  }
  for (const rule of state.recurringRules) {
    if (rule.active) codes.add(normalizeCode(rule.template.currency));
  }
  codes.delete(base);
  return [...codes].filter((code) => FRANKFURTER_UNSUPPORTED.has(code)).sort();
}

/** A live (non-tombstoned) row already answers this exact currency/date pair. */
function isAlreadyCovered(state: FinanceState, currency: string, localDate: string): boolean {
  const base = normalizeCode(state.settings.baseCurrency);
  return state.exchangeRates.some(
    (rate) =>
      rate.fromCurrency === currency && rate.toCurrency === base && rate.effectiveDate === localDate,
  );
}

const pairKey = (currency: string, localDate: string) => `${currency}|${localDate}`;

export class ExchangeRateService {
  private status: ExchangeRateStatus = INITIAL_STATUS;
  private readonly listeners = new Set<() => void>();
  private readonly negativeCache = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<EnsureRatesResult>>();
  private refreshPromise: Promise<void> | null = null;

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
      next.lastRefreshAt === this.status.lastRefreshAt &&
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

  neededCurrencies(state: FinanceState): string[] {
    return neededCurrencies(state);
  }

  private isNegativeCached(key: string): boolean {
    const at = this.negativeCache.get(key);
    if (at === undefined) return false;
    if (this.now().getTime() - at > NEGATIVE_CACHE_MS) {
      this.negativeCache.delete(key);
      return false;
    }
    return true;
  }

  /** Writes the opt-in flag. Turning it on immediately forces a refresh. */
  setEnabled = async (on: boolean): Promise<void> => {
    await this.deps.storage.transact((tx) => writeRatesFlag(tx, { enabled: on }));
    this.setStatus({ enabled: on });
    if (on) await this.refreshLatest({ force: true });
  };

  /**
   * Fetches today's rates for every currency this vault needs, if the flag is on, something is
   * needed, and (absent `force`) the last refresh was more than six hours ago.
   *
   * Never throws. A concurrent call while one is already in flight returns the same promise
   * rather than issuing a second request.
   */
  refreshLatest = (options: { force?: boolean } = {}): Promise<void> => {
    if (this.refreshPromise) return this.refreshPromise;
    const run = this.refreshLatestNow(options).finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = run;
    return run;
  };

  private async refreshLatestNow({ force }: { force?: boolean }): Promise<void> {
    const state = this.deps.getState();
    this.setStatus({ unsupported: unsupportedCurrencies(state) });

    const flag = await this.deps.storage.transact((tx) => readRatesFlag(tx));
    this.setStatus({ enabled: flag.enabled });
    if (!flag.enabled) return;

    const needed = neededCurrencies(state);
    if (!needed.length) return;

    if (!force) {
      const last = flag.lastRefreshAt ? Date.parse(flag.lastRefreshAt) : NaN;
      if (Number.isFinite(last) && this.now().getTime() - last < REFRESH_INTERVAL_MS) return;
    }

    const base = normalizeCode(state.settings.baseCurrency);
    this.setStatus({ fetching: true });
    try {
      const quotes = [...new Set([...needed, base])];
      const rows = await fetchEurRates(
        { fetch: this.deps.fetch, timeoutMs: this.deps.timeoutMs },
        { quotes },
      );
      const derived = deriveBaseRates(rows, base, needed);
      const result = await this.deps.repository.saveFetchedRates(derived);
      const at = this.now().toISOString();
      await this.deps.storage.transact((tx) => writeRatesFlag(tx, { lastRefreshAt: at }));
      this.setStatus({ fetching: false, lastError: null, lastRefreshAt: at, conflicts: result.conflicts });
    } catch (error) {
      this.setStatus({
        fetching: false,
        lastError: error instanceof RateFetchError ? error.code : 'malformed',
      });
    }
  }

  /**
   * Fills in whatever rates `pairs` are missing, with one range request for the lot.
   *
   * A no-op — no fetch, nothing cached — when the flag is off, so this is always safe to call
   * from the transaction form or CSV preview without checking the flag first. Never throws.
   */
  ensureRatesFor = async (pairs: readonly RatePair[]): Promise<EnsureRatesResult> => {
    const state = this.deps.getState();
    const base = normalizeCode(state.settings.baseCurrency);
    const today = this.todayLocal();

    const flag = await this.deps.storage.transact((tx) => readRatesFlag(tx));
    this.setStatus({ enabled: flag.enabled });
    if (!flag.enabled) return { ok: true, conflicts: [] };

    const wanted = new Map<string, RatePair>();
    for (const pair of pairs) {
      const currency = normalizeCode(pair.currency);
      if (currency === base || FRANKFURTER_UNSUPPORTED.has(currency)) continue;
      if (!isLocalDate(pair.localDate)) continue;
      const localDate = pair.localDate > today ? today : pair.localDate;
      if (isAlreadyCovered(state, currency, localDate)) continue;
      const key = pairKey(currency, localDate);
      if (this.isNegativeCached(key)) continue;
      wanted.set(key, { currency, localDate });
    }
    if (!wanted.size) return { ok: true, conflicts: [] };

    const dedupeKey = [...wanted.keys()].sort().join(',');
    const pending = this.inFlight.get(dedupeKey);
    if (pending) return pending;

    const task = this.ensureRatesForNow(base, wanted).finally(() => {
      this.inFlight.delete(dedupeKey);
    });
    this.inFlight.set(dedupeKey, task);
    return task;
  };

  private async ensureRatesForNow(
    base: string,
    wanted: ReadonlyMap<string, RatePair>,
  ): Promise<EnsureRatesResult> {
    const entries = [...wanted.values()];
    const dates = entries.map((entry) => entry.localDate).sort();
    const currencies = [...new Set(entries.map((entry) => entry.currency))];
    const minDate = dates[0]!;
    const maxDate = dates[dates.length - 1]!;

    this.setStatus({ fetching: true });
    try {
      const quotes = [...new Set([...currencies, base])];
      const rows = await fetchEurRates(
        { fetch: this.deps.fetch, timeoutMs: this.deps.timeoutMs },
        minDate === maxDate ? { quotes, date: minDate } : { quotes, from: minDate, to: maxDate },
      );
      const derived = deriveBaseRates(rows, base, currencies);
      const filtered = derived.filter((rate) => wanted.has(pairKey(rate.fromCurrency, rate.effectiveDate)));
      const result: FetchedRateResult = filtered.length
        ? await this.deps.repository.saveFetchedRates(filtered)
        : { written: 0, skippedManual: 0, conflicts: [] };
      this.setStatus({ fetching: false, lastError: null, conflicts: result.conflicts });
      return { ok: true, conflicts: result.conflicts };
    } catch (error) {
      const at = this.now().getTime();
      for (const key of wanted.keys()) this.negativeCache.set(key, at);
      this.setStatus({
        fetching: false,
        lastError: error instanceof RateFetchError ? error.code : 'malformed',
      });
      return { ok: false, conflicts: [] };
    }
  }
}

export function createExchangeRateService(deps: ExchangeRateServiceDeps): ExchangeRateService {
  return new ExchangeRateService(deps);
}

// Re-exported so callers building `RateInput[]` by hand (tests, mostly) don't need a second
// import just for the type.
export type { RateInput };
