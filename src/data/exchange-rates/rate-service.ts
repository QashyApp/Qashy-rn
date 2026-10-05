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
 * Every public method is failure-shaped rather than throw-shaped: a network error, a timeout, or
 * a malformed response is recorded on `status` and swallowed, because a rate lookup must never
 * take down app startup, a foreground resume, or a CSV import.
 */

import {
  deriveBaseRates,
  FRANKFURTER_UNSUPPORTED,
} from "@/data/exchange-rates/frankfurter";
import {
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
  /** False only when the request itself failed (offline, timeout, malformed, …). */
  readonly ok: boolean;
  readonly conflicts: readonly FetchedRateConflict[];
}

export interface EnsureRatesOptions {
  /** Also retries pairs a recent failure put in the negative cache. */
  readonly retry?: boolean;
}

export interface ExchangeRateStatus {
  readonly enabled: boolean;
  readonly fetching: boolean;
  readonly lastError: RateFetchErrorCode | null;
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

const pairKey = (currency: string, localDate: string) =>
  `${currency}|${localDate}`;

export class ExchangeRateService {
  private status: ExchangeRateStatus = INITIAL_STATUS;
  private readonly listeners = new Set<() => void>();
  private readonly negativeCache = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<EnsureRatesResult>>();

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

  /** Writes the on/off flag. Turning it on immediately looks up whatever is pending. */
  setEnabled = async (on: boolean): Promise<void> => {
    await this.deps.storage.transact((tx) =>
      writeRatesFlag(tx, { enabled: on }),
    );
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
    const state = this.deps.getState();
    const base = normalizeCode(state.settings.baseCurrency);
    const today = this.todayLocal();
    this.setStatus({ unsupported: unsupportedCurrencies(state) });

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
      if (!options.retry && this.isNegativeCached(key)) continue;
      wanted.set(key, { currency, localDate });
    }
    if (!wanted.size) return { ok: true, conflicts: [] };

    const dedupeKey = [...wanted.keys()].sort().join(",");
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
        { quotes, from: shiftDate(minDate, -LOOKBACK_DAYS), to: maxDate },
      );
      const derived = deriveBaseRates(rows, base, currencies);
      // Each wanted pair is answered by the latest published rate on or before its date, saved
      // under the wanted date so the exact-date coverage check holds and it is not refetched.
      const latestByCurrency = new Map<string, typeof derived>();
      for (const rate of derived) {
        const list = latestByCurrency.get(rate.fromCurrency) ?? [];
        list.push(rate);
        latestByCurrency.set(rate.fromCurrency, list);
      }
      const filtered: typeof derived = [];
      for (const entry of wanted.values()) {
        let best: (typeof derived)[number] | undefined;
        for (const rate of latestByCurrency.get(entry.currency) ?? []) {
          if (
            rate.effectiveDate <= entry.localDate &&
            (!best || rate.effectiveDate > best.effectiveDate)
          ) {
            best = rate;
          }
        }
        if (best) filtered.push({ ...best, effectiveDate: entry.localDate });
      }
      const result: FetchedRateResult = filtered.length
        ? await this.deps.repository.saveFetchedRates(filtered)
        : { written: 0, skippedManual: 0, conflicts: [] };
      // A pair Frankfurter had no data for would otherwise be asked for again on every call.
      const answered = new Set(
        filtered.map((rate) => pairKey(rate.fromCurrency, rate.effectiveDate)),
      );
      const at = this.now().getTime();
      for (const key of wanted.keys()) {
        if (!answered.has(key)) this.negativeCache.set(key, at);
      }
      this.setStatus({
        fetching: false,
        lastError: null,
        conflicts: result.conflicts,
      });
      return { ok: true, conflicts: result.conflicts };
    } catch (error) {
      const at = this.now().getTime();
      for (const key of wanted.keys()) this.negativeCache.set(key, at);
      this.setStatus({
        fetching: false,
        lastError: error instanceof RateFetchError ? error.code : "malformed",
      });
      return { ok: false, conflicts: [] };
    }
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
