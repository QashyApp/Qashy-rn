import type { TransactionRecord } from '@/domain/models';
import { dayNetMinor } from '@/features/transactions/list/summary';

function makeTransaction(overrides: Partial<TransactionRecord>): TransactionRecord {
  return {
    id: 'id',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    kind: 'expense',
    status: 'posted',
    title: 'Transaction',
    note: '',
    localDate: '2026-01-01',
    accountId: 'account-1',
    destinationAccountId: null,
    categoryId: null,
    tagIds: [],
    amountMinor: 0,
    destinationAmountMinor: null,
    destinationBaseAmountMinor: null,
    currency: 'USD',
    destinationCurrency: null,
    exchangeRate: '1',
    baseAmountMinor: 0,
    transferGroupId: null,
    recurringRuleId: null,
    occurrenceKey: null,
    ...overrides,
  };
}

describe('dayNetMinor', () => {
  it('adds income and subtracts expense, both in base-currency minor units', () => {
    const net = dayNetMinor([
      makeTransaction({ kind: 'income', baseAmountMinor: 5000 }),
      makeTransaction({ kind: 'expense', baseAmountMinor: 1200 }),
    ]);
    expect(net).toBe(3800);
  });

  it('excludes transfers, which never count as income or expense', () => {
    const net = dayNetMinor([
      makeTransaction({ kind: 'income', baseAmountMinor: 1000 }),
      makeTransaction({ kind: 'transfer', baseAmountMinor: 99999 }),
    ]);
    expect(net).toBe(1000);
  });

  it('totals mixed-currency transactions through their snapshotted base amount', () => {
    // amountMinor stays in the transaction's own currency; baseAmountMinor is
    // what actually gets summed, so a day mixing EUR and USD still totals
    // correctly in the base currency.
    const net = dayNetMinor([
      makeTransaction({ kind: 'income', currency: 'EUR', amountMinor: 900, baseAmountMinor: 1000 }),
      makeTransaction({ kind: 'expense', currency: 'USD', amountMinor: 400, baseAmountMinor: 400 }),
    ]);
    expect(net).toBe(600);
  });

  it('returns 0 for an empty day', () => {
    expect(dayNetMinor([])).toBe(0);
  });

  it('includes upcoming transactions, matching whatever the caller passes in', () => {
    const net = dayNetMinor([
      makeTransaction({ kind: 'expense', status: 'upcoming', baseAmountMinor: 250 }),
    ]);
    expect(net).toBe(-250);
  });
});
