import type { AppSettings, ExchangeRate, FinanceState } from '@/domain/models';
import { fetchedRateId } from '@/utils/deterministic-id';
import { appliedCrossRateFor, appliedRateFor } from '@/utils/rates';

function settings(baseCurrency: string): AppSettings {
  return {
    id: 'settings',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    onboardingComplete: true,
    locale: 'en-US',
    baseCurrency,
    themeMode: 'system',
    accentSource: 'system',
    accentHex: '#5966E9',
  };
}

let counter = 0;
function rate(overrides: Partial<ExchangeRate> & Pick<ExchangeRate, 'fromCurrency' | 'toCurrency' | 'effectiveDate' | 'rate'>): ExchangeRate {
  counter += 1;
  return {
    id: `manual-${counter}`,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function fetched(overrides: Pick<ExchangeRate, 'fromCurrency' | 'toCurrency' | 'effectiveDate' | 'rate'> & Partial<ExchangeRate>): ExchangeRate {
  return rate({
    ...overrides,
    id: fetchedRateId(overrides.fromCurrency, overrides.toCurrency, overrides.effectiveDate),
  });
}

function state(baseCurrency: string, exchangeRates: ExchangeRate[]): FinanceState {
  return {
    ready: true,
    settings: settings(baseCurrency),
    accounts: [],
    categories: [],
    tags: [],
    transactions: [],
    budgets: [],
    budgetPeriods: [],
    goals: [],
    contributions: [],
    recurringRules: [],
    exchangeRates,
  };
}

describe('appliedRateFor', () => {
  it('returns null for the base currency itself — there is nothing to apply', () => {
    expect(appliedRateFor(state('USD', []), 'USD', '2026-09-25')).toBeNull();
  });

  it('returns null when neither direction has a row on or before the date', () => {
    const rates = [fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-30', rate: '1.1' })];
    expect(appliedRateFor(state('USD', rates), 'EUR', '2026-09-25')).toBeNull();
  });

  it('picks a direct row and reports it automatic when its id is the fetched-rate hash', () => {
    const rates = [fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-25', rate: '1.17734' })];
    expect(appliedRateFor(state('USD', rates), 'EUR', '2026-09-25')).toEqual({
      rate: '1.17734',
      effectiveDate: '2026-09-25',
      automatic: true,
    });
  });

  it('reports a manually entered direct row as not automatic', () => {
    const rates = [rate({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-25', rate: '1.2' })];
    expect(appliedRateFor(state('USD', rates), 'EUR', '2026-09-25')?.automatic).toBe(false);
  });

  it('falls back to the inverse of a base→currency row when no direct row exists', () => {
    // 1 USD = 0.85 EUR, so 1 EUR = 1/0.85 USD.
    const rates = [fetched({ fromCurrency: 'USD', toCurrency: 'EUR', effectiveDate: '2026-09-25', rate: '0.85' })];
    const applied = appliedRateFor(state('USD', rates), 'EUR', '2026-09-25');
    expect(applied?.automatic).toBe(true);
    expect(applied?.effectiveDate).toBe('2026-09-25');
    expect(Number(applied?.rate)).toBeCloseTo(1 / 0.85, 8);
  });

  it('prefers a direct row over an inverse one when both exist', () => {
    const rates = [
      fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-25', rate: '1.17734' }),
      fetched({ fromCurrency: 'USD', toCurrency: 'EUR', effectiveDate: '2026-09-25', rate: '0.85' }),
    ];
    expect(appliedRateFor(state('USD', rates), 'EUR', '2026-09-25')?.rate).toBe('1.17734');
  });

  it('orders by effectiveDate descending, never picking a later date than requested', () => {
    const rates = [
      fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-20', rate: '1.10' }),
      fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-24', rate: '1.15' }),
      fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-30', rate: '1.30' }),
    ];
    expect(appliedRateFor(state('USD', rates), 'EUR', '2026-09-25')).toMatchObject({ rate: '1.15', effectiveDate: '2026-09-24' });
  });

  it('breaks a same-day tie by updatedAt descending, matching directOrInverseRate', () => {
    const older = rate({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-25', rate: '1.10', updatedAt: '2026-09-25T08:00:00.000Z' });
    const newer = rate({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-25', rate: '1.20', updatedAt: '2026-09-25T09:00:00.000Z' });
    expect(appliedRateFor(state('USD', [older, newer]), 'EUR', '2026-09-25')?.rate).toBe('1.20');
    expect(appliedRateFor(state('USD', [newer, older]), 'EUR', '2026-09-25')?.rate).toBe('1.20');
  });

  it('never resurrects a tombstoned row', () => {
    const rates = [rate({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-25', rate: '1.10', deletedAt: '2026-09-25T10:00:00.000Z' })];
    expect(appliedRateFor(state('USD', rates), 'EUR', '2026-09-25')).toBeNull();
  });

  it('is case-insensitive on currency codes', () => {
    const rates = [fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-25', rate: '1.17734' })];
    expect(appliedRateFor(state('usd', rates), 'eur', '2026-09-25')?.rate).toBe('1.17734');
  });
});

describe('appliedCrossRateFor', () => {
  it('returns null when the two currencies are the same', () => {
    expect(appliedCrossRateFor(state('USD', []), 'EUR', 'EUR', '2026-09-25')).toBeNull();
  });

  it('picks a direct row between the two currencies before pivoting', () => {
    const rates = [fetched({ fromCurrency: 'EUR', toCurrency: 'GBP', effectiveDate: '2026-09-25', rate: '0.85' })];
    expect(appliedCrossRateFor(state('USD', rates), 'EUR', 'GBP', '2026-09-25')).toEqual({
      rate: '0.85',
      effectiveDate: '2026-09-25',
      automatic: true,
    });
  });

  it('falls back to the inverse of a direct row', () => {
    const rates = [fetched({ fromCurrency: 'GBP', toCurrency: 'EUR', effectiveDate: '2026-09-25', rate: '1.2' })];
    const applied = appliedCrossRateFor(state('USD', rates), 'EUR', 'GBP', '2026-09-25');
    expect(applied?.automatic).toBe(true);
    expect(Number(applied?.rate)).toBeCloseTo(1 / 1.2, 8);
  });

  it('pivots through the base currency when neither leg is the base and no direct row exists', () => {
    // 1 EUR = 1.1 USD, 1 GBP = 1.32 USD, so 1 EUR = 1.1 / 1.32 GBP.
    const rates = [
      fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-20', rate: '1.1' }),
      fetched({ fromCurrency: 'GBP', toCurrency: 'USD', effectiveDate: '2026-09-24', rate: '1.32' }),
    ];
    const applied = appliedCrossRateFor(state('USD', rates), 'EUR', 'GBP', '2026-09-25');
    expect(Number(applied?.rate)).toBeCloseTo(1.1 / 1.32, 8);
    // The older of the two pivot legs' dates.
    expect(applied?.effectiveDate).toBe('2026-09-20');
    expect(applied?.automatic).toBe(true);
  });

  it('reports automatic false when either pivot leg is manual', () => {
    const rates = [
      fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-20', rate: '1.1' }),
      rate({ fromCurrency: 'GBP', toCurrency: 'USD', effectiveDate: '2026-09-24', rate: '1.32' }),
    ];
    expect(appliedCrossRateFor(state('USD', rates), 'EUR', 'GBP', '2026-09-25')?.automatic).toBe(false);
  });

  it('returns null when one pivot leg is missing', () => {
    const rates = [fetched({ fromCurrency: 'EUR', toCurrency: 'USD', effectiveDate: '2026-09-20', rate: '1.1' })];
    expect(appliedCrossRateFor(state('USD', rates), 'EUR', 'GBP', '2026-09-25')).toBeNull();
  });

  it('returns null rather than pivoting when one currency is the base and no direct/inverse row exists', () => {
    expect(appliedCrossRateFor(state('USD', []), 'USD', 'GBP', '2026-09-25')).toBeNull();
    expect(appliedCrossRateFor(state('USD', []), 'EUR', 'USD', '2026-09-25')).toBeNull();
  });

  it('is case-insensitive on currency codes', () => {
    const rates = [fetched({ fromCurrency: 'EUR', toCurrency: 'GBP', effectiveDate: '2026-09-25', rate: '0.85' })];
    expect(appliedCrossRateFor(state('USD', rates), 'eur', 'gbp', '2026-09-25')?.rate).toBe('0.85');
  });
});
