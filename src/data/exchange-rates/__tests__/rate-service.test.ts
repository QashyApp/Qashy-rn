import { createExchangeRateService, neededCurrencies, unsupportedCurrencies } from '@/data/exchange-rates/rate-service';
import { readRatesFlag, writeRatesFlag } from '@/data/exchange-rates/rates-flag';
import { MemoryStorageAdapter } from '@/data/memory-storage';
import type { FetchedRateResult, RateInput } from '@/data/repository';
import type { Account, AppSettings, ExchangeRate, FinanceState, RecurringRule } from '@/domain/models';

const ENTITY_STAMP = { revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null };

let accountSeq = 0;
function account(overrides: Partial<Account> = {}): Account {
  accountSeq += 1;
  return {
    id: `account-${accountSeq}`,
    ...ENTITY_STAMP,
    name: 'Account',
    type: 'checking',
    currency: 'USD',
    openingBalanceMinor: 0,
    icon: 'wallet',
    color: '#000000',
    archived: false,
    ...overrides,
  };
}

const defaultTemplate = {
  kind: 'expense' as const,
  title: 'Rent',
  note: '',
  accountId: 'account-1',
  categoryId: null,
  tagIds: [] as string[],
  amountMinor: 1000,
  currency: 'GBP',
};

let ruleSeq = 0;
function recurringRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  ruleSeq += 1;
  return {
    id: `rule-${ruleSeq}`,
    ...ENTITY_STAMP,
    template: defaultTemplate,
    unit: 'month',
    interval: 1,
    startDate: '2026-01-01',
    endDate: null,
    nextDueDate: '2026-10-01',
    autoPost: true,
    active: true,
    pausedByDependency: false,
    ...overrides,
  };
}

let rateSeq = 0;
function exchangeRate(overrides: Partial<ExchangeRate> = {}): ExchangeRate {
  rateSeq += 1;
  return {
    id: `rate-${rateSeq}`,
    ...ENTITY_STAMP,
    fromCurrency: 'GBP',
    toCurrency: 'EUR',
    rate: '1.15',
    effectiveDate: '2026-09-20',
    ...overrides,
  };
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 'settings',
    ...ENTITY_STAMP,
    onboardingComplete: true,
    locale: 'en-US',
    baseCurrency: 'EUR',
    themeId: 'classic',
    themeMode: 'system',
    accentSource: 'system',
    accentHex: '#000000',
    ...overrides,
  };
}

function makeState(overrides: Partial<FinanceState> = {}): FinanceState {
  return {
    ready: true,
    settings: settings(),
    accounts: [],
    categories: [],
    tags: [],
    transactions: [],
    budgets: [],
    budgetPeriods: [],
    budgetAdjustments: [],
    goals: [],
    contributions: [],
    recurringRules: [],
    exchangeRates: [],
    ...overrides,
  };
}

/** Enumerates every calendar date from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return dates;
}

const LATEST_KEY = '__latest__';

/**
 * A fake `fetch` that answers a Frankfurter `/v2/rates` request from a fixed EUR-pivot table,
 * without ever touching the network. `ratesByDate[date][quote]` is the EUR-pivot rate; a
 * request with no `date`/`from`/`to` (the "latest" form) is answered from `ratesByDate[LATEST_KEY]`.
 */
function fakeFetch(
  ratesByDate: Record<string, Record<string, number>>,
  onCall?: (url: string) => void,
): jest.Mock {
  return jest.fn(async (url: string) => {
    onCall?.(url);
    const parsed = new URL(url);
    const quotes = (parsed.searchParams.get('quotes') ?? '').split(',').filter(Boolean);
    const date = parsed.searchParams.get('date');
    const from = parsed.searchParams.get('from');
    const to = parsed.searchParams.get('to');
    const dates = date ? [date] : from && to ? enumerateDates(from, to) : [LATEST_KEY];
    const rows: { date: string; base: string; quote: string; rate: number }[] = [];
    for (const requestDate of dates) {
      const dayRates = ratesByDate[requestDate] ?? {};
      for (const quote of quotes) {
        const rate = dayRates[quote];
        if (rate !== undefined) {
          rows.push({ date: requestDate === LATEST_KEY ? '2026-09-25' : requestDate, base: 'EUR', quote, rate });
        }
      }
    }
    return { ok: true, status: 200, json: async () => rows } as Response;
  });
}

function failingFetch(): jest.Mock {
  return jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
}

interface Harness {
  readonly storage: MemoryStorageAdapter;
  readonly saveFetchedRates: jest.Mock<Promise<FetchedRateResult>, [readonly RateInput[]]>;
  state: FinanceState;
  clockMs: number;
  today: string;
  fetch: jest.Mock;
  readonly service: ReturnType<typeof createExchangeRateService>;
}

async function harness(options: {
  state?: FinanceState;
  enabled?: boolean;
  lastRefreshAt?: string;
  fetch?: jest.Mock;
  clockMs?: number;
  today?: string;
} = {}): Promise<Harness> {
  const storage = new MemoryStorageAdapter();
  await storage.initialize();
  if (options.enabled !== undefined || options.lastRefreshAt !== undefined) {
    await storage.transact((tx) =>
      writeRatesFlag(tx, { enabled: options.enabled ?? false, lastRefreshAt: options.lastRefreshAt }),
    );
  }
  const saveFetchedRates = jest.fn(async (rates: readonly RateInput[]): Promise<FetchedRateResult> => ({
    written: rates.length,
    skippedManual: 0,
    conflicts: [],
  }));
  const state = options.state ?? makeState();
  const fetch = options.fetch ?? fakeFetch({});
  const box = { state, clockMs: options.clockMs ?? Date.parse('2026-09-25T12:00:00.000Z'), today: options.today ?? '2026-09-25' };
  const service = createExchangeRateService({
    storage,
    repository: { saveFetchedRates },
    getState: () => box.state,
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => new Date(box.clockMs),
    todayLocal: () => box.today,
  });
  return {
    storage,
    saveFetchedRates,
    get state() { return box.state; },
    set state(next: FinanceState) { box.state = next; },
    get clockMs() { return box.clockMs; },
    set clockMs(next: number) { box.clockMs = next; },
    get today() { return box.today; },
    set today(next: string) { box.today = next; },
    fetch,
    service,
  };
}

describe('neededCurrencies', () => {
  it('collects non-archived account currencies and active recurring rule currencies, minus base', () => {
    const state = makeState({
      settings: settings({ baseCurrency: 'EUR' }),
      accounts: [
        account({ currency: 'USD' }),
        account({ currency: 'EUR' }), // same as base: dropped
        account({ currency: 'GBP', archived: true }), // archived: dropped
      ],
      recurringRules: [
        recurringRule({ template: { ...defaultTemplate, currency: 'JPY' }, active: true }),
        recurringRule({ template: { ...defaultTemplate, currency: 'CHF' }, active: false }), // inactive: dropped
      ],
    });
    expect(neededCurrencies(state)).toEqual(['JPY', 'USD']);
  });

  it('excludes currencies Frankfurter does not support', () => {
    const state = makeState({
      settings: settings({ baseCurrency: 'EUR' }),
      accounts: [account({ currency: 'ZWL' }), account({ currency: 'USD' })],
    });
    expect(neededCurrencies(state)).toEqual(['USD']);
  });

  it('returns an empty list when nothing is needed', () => {
    expect(neededCurrencies(makeState())).toEqual([]);
  });
});

describe('unsupportedCurrencies', () => {
  it('lists in-use currencies Frankfurter does not cover', () => {
    const state = makeState({
      settings: settings({ baseCurrency: 'EUR' }),
      accounts: [account({ currency: 'ZWL' }), account({ currency: 'USD' })],
    });
    expect(unsupportedCurrencies(state)).toEqual(['ZWL']);
  });
});

describe('privacy: the flag off means fetch is never called', () => {
  it('refreshLatest makes no request when the flag is off', async () => {
    const fetch = fakeFetch({ [LATEST_KEY]: { USD: 1.1 } });
    const { service } = await harness({
      state: makeState({ accounts: [account({ currency: 'USD' })] }),
      fetch,
      // enabled left unset: absent means off.
    });
    await service.refreshLatest();
    expect(fetch).not.toHaveBeenCalled();
    expect(service.getStatus().enabled).toBe(false);
  });

  it('ensureRatesFor makes no request when the flag is off', async () => {
    const fetch = fakeFetch({ '2026-09-20': { USD: 1.1 } });
    const { service } = await harness({ fetch });
    const result = await service.ensureRatesFor([{ currency: 'USD', localDate: '2026-09-20' }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, conflicts: [] });
  });
});

describe('refreshLatest', () => {
  it('does nothing when nothing is needed, even if enabled', async () => {
    const fetch = fakeFetch({ [LATEST_KEY]: {} });
    const { service } = await harness({ enabled: true, fetch, state: makeState() });
    await service.refreshLatest();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throttles to once per six hours unless forced', async () => {
    const fetch = fakeFetch({ [LATEST_KEY]: { USD: 1.1 } });
    const rig = await harness({
      enabled: true,
      lastRefreshAt: '2026-09-25T11:00:00.000Z', // one hour before the clock below
      fetch,
      state: makeState({ accounts: [account({ currency: 'USD' })] }),
      clockMs: Date.parse('2026-09-25T12:00:00.000Z'),
    });
    await rig.service.refreshLatest();
    expect(fetch).not.toHaveBeenCalled();

    await rig.service.refreshLatest({ force: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches once the throttle window has passed', async () => {
    const fetch = fakeFetch({ [LATEST_KEY]: { USD: 1.1 } });
    const rig = await harness({
      enabled: true,
      lastRefreshAt: '2026-09-25T00:00:00.000Z', // seven hours before the clock below
      fetch,
      state: makeState({ accounts: [account({ currency: 'USD' })] }),
      clockMs: Date.parse('2026-09-25T07:00:00.000Z'),
    });
    await rig.service.refreshLatest();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('saves the derived rates and records the refresh time', async () => {
    const fetch = fakeFetch({ [LATEST_KEY]: { USD: 1.1 } });
    const rig = await harness({
      enabled: true,
      fetch,
      state: makeState({ accounts: [account({ currency: 'USD' })] }),
    });
    await rig.service.refreshLatest();
    expect(rig.saveFetchedRates).toHaveBeenCalledTimes(1);
    const [rates] = rig.saveFetchedRates.mock.calls[0]!;
    expect(rates).toEqual([{ fromCurrency: 'USD', toCurrency: 'EUR', effectiveDate: '2026-09-25', rate: expect.any(String) }]);
    expect(rig.service.getStatus().lastRefreshAt).toBe(new Date(rig.clockMs).toISOString());
    expect(rig.service.getStatus().lastError).toBeNull();

    const flag = await rig.storage.transact((tx) => readRatesFlag(tx));
    expect(flag.lastRefreshAt).toBe(new Date(rig.clockMs).toISOString());
  });

  it('records a failure on status without throwing', async () => {
    const fetch = failingFetch();
    const rig = await harness({
      enabled: true,
      fetch,
      state: makeState({ accounts: [account({ currency: 'USD' })] }),
    });
    await expect(rig.service.refreshLatest()).resolves.toBeUndefined();
    expect(rig.service.getStatus().lastError).toBe('http');
    expect(rig.service.getStatus().fetching).toBe(false);
    expect(rig.saveFetchedRates).not.toHaveBeenCalled();
  });

  it('setEnabled(true) writes the flag and forces an immediate refresh', async () => {
    const fetch = fakeFetch({ [LATEST_KEY]: { USD: 1.1 } });
    const rig = await harness({ fetch, state: makeState({ accounts: [account({ currency: 'USD' })] }) });
    await rig.service.setEnabled(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rig.service.getStatus().enabled).toBe(true);
    expect((await rig.storage.transact((tx) => readRatesFlag(tx))).enabled).toBe(true);
  });
});

describe('ensureRatesFor', () => {
  it('filters unsupported, base, and already-covered pairs; clamps future dates; makes one range request; saves only the requested dates', async () => {
    const calledUrls: string[] = [];
    const fetch = fakeFetch(
      {
        '2026-09-18': { USD: 1.1, JPY: 160 },
        '2026-09-19': { USD: 1.1, JPY: 160 },
        '2026-09-20': { USD: 1.1, JPY: 160 },
        '2026-09-21': { USD: 1.1, JPY: 160 },
        '2026-09-22': { USD: 1.1, JPY: 160 },
        '2026-09-23': { USD: 1.1, JPY: 160 },
        '2026-09-24': { USD: 1.1, JPY: 160 },
        '2026-09-25': { USD: 1.1, JPY: 160 },
      },
      (url) => calledUrls.push(url),
    );
    const rig = await harness({
      enabled: true,
      fetch,
      today: '2026-09-25',
      state: makeState({
        exchangeRates: [exchangeRate({ fromCurrency: 'GBP', toCurrency: 'EUR', effectiveDate: '2026-09-20' })],
      }),
    });

    const result = await rig.service.ensureRatesFor([
      { currency: 'USD', localDate: '2026-09-18' }, // wanted
      { currency: 'GBP', localDate: '2026-09-20' }, // already covered
      { currency: 'ZWL', localDate: '2026-09-19' }, // unsupported
      { currency: 'EUR', localDate: '2026-09-19' }, // base currency
      { currency: 'JPY', localDate: '2026-09-30' }, // future: clamped to today (2026-09-25)
    ]);

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calledUrls[0]).toContain('from=2026-09-18&to=2026-09-25');
    expect(calledUrls[0]).toContain('quotes=JPY,USD');
    expect(calledUrls[0]).not.toContain('GBP');
    expect(calledUrls[0]).not.toContain('ZWL');

    expect(rig.saveFetchedRates).toHaveBeenCalledTimes(1);
    const [savedRates] = rig.saveFetchedRates.mock.calls[0]!;
    expect(savedRates).toHaveLength(2);
    expect(savedRates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromCurrency: 'USD', effectiveDate: '2026-09-18' }),
        expect.objectContaining({ fromCurrency: 'JPY', effectiveDate: '2026-09-25' }),
      ]),
    );
  });

  it('issues a single-date request (not a range) when every wanted pair falls on the same day', async () => {
    const calledUrls: string[] = [];
    const fetch = fakeFetch({ '2026-09-20': { USD: 1.1, GBP: 0.86 } }, (url) => calledUrls.push(url));
    const rig = await harness({ enabled: true, fetch, today: '2026-09-25' });

    await rig.service.ensureRatesFor([
      { currency: 'USD', localDate: '2026-09-20' },
      { currency: 'GBP', localDate: '2026-09-20' },
    ]);

    expect(calledUrls[0]).toContain('date=2026-09-20');
    expect(calledUrls[0]).not.toContain('from=');
  });

  it('never throws and reports ok: false on a request failure', async () => {
    const fetch = failingFetch();
    const rig = await harness({ enabled: true, fetch });
    const result = await rig.service.ensureRatesFor([{ currency: 'USD', localDate: '2026-09-20' }]);
    expect(result).toEqual({ ok: false, conflicts: [] });
    expect(rig.service.getStatus().lastError).toBe('http');
  });

  it('negative-caches a failed pair so it is not retried for a few minutes, then retries after it expires', async () => {
    const fetch = failingFetch();
    const rig = await harness({ enabled: true, fetch, clockMs: Date.parse('2026-09-25T12:00:00.000Z') });
    const pair = [{ currency: 'USD', localDate: '2026-09-20' }];

    await rig.service.ensureRatesFor(pair);
    expect(fetch).toHaveBeenCalledTimes(1);

    await rig.service.ensureRatesFor(pair);
    expect(fetch).toHaveBeenCalledTimes(1); // still cached: no second attempt

    rig.clockMs += 6 * 60 * 1000; // past the ~5 minute expiry
    await rig.service.ensureRatesFor(pair);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent calls for the same pairs into a single request', async () => {
    const fetch = fakeFetch({ '2026-09-20': { USD: 1.1 } });
    const rig = await harness({ enabled: true, fetch });
    const pair = [{ currency: 'USD', localDate: '2026-09-20' }];

    const [first, second] = await Promise.all([
      rig.service.ensureRatesFor(pair),
      rig.service.ensureRatesFor(pair),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('is a no-op when every pair is already covered, unsupported, or the base currency', async () => {
    const fetch = fakeFetch({ '2026-09-20': { USD: 1.1 } });
    const rig = await harness({
      enabled: true,
      fetch,
      state: makeState({ exchangeRates: [exchangeRate({ fromCurrency: 'USD', toCurrency: 'EUR', effectiveDate: '2026-09-20' })] }),
    });
    const result = await rig.service.ensureRatesFor([
      { currency: 'USD', localDate: '2026-09-20' },
      { currency: 'EUR', localDate: '2026-09-20' },
      { currency: 'ZWL', localDate: '2026-09-20' },
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, conflicts: [] });
  });
});
