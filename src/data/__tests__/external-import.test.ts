import type { ImportBundle } from '@/data/import/types';
import { LocalFinanceRepository } from '@/data/local-finance-repository';
import { MemoryStorageAdapter } from '@/data/memory-storage';
import type { StorageAdapter } from '@/data/storage-adapter';
import { SyncingStorageAdapter } from '@/data/syncing-storage-adapter';
import type { EntityType } from '@/domain/models';
import { DEVICE_A } from '@/sync/oplog/__tests__/helpers';
import { externalImportId } from '@/utils/deterministic-id';

const NOW = new Date('2026-07-15T09:00:00Z');

async function createRepository(storage: StorageAdapter = new MemoryStorageAdapter()) {
  const repository = new LocalFinanceRepository(storage);
  await repository.initialize();
  await repository.completeOnboarding({
    locale: 'en-US',
    baseCurrency: 'USD',
    accountName: 'Everyday',
    accountType: 'checking',
    openingBalanceMinor: 0,
    themeMode: 'system',
    accentSource: 'system',
    accentHex: '#5966E9',
  });
  return { repository, storage };
}

/** Synthetic data only: a small vault-shaped bundle that exercises every entity type. */
function makeBundle(overrides: Partial<ImportBundle> = {}): ImportBundle {
  return {
    source: 'cashew',
    timeZone: 'UTC',
    timeZoneSource: 'device',
    accounts: [
      { externalId: 'a-cash', name: 'Cash', type: 'cash', currency: 'USD', openingBalanceMinor: 10_000, icon: 'wallet', color: '#00a58e', archived: false },
      { externalId: 'a-bank', name: 'Bank', type: 'checking', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false },
    ],
    categories: [
      // The child precedes its parent on purpose: a backup's row order is arbitrary.
      { externalId: 'c-child', name: 'Takeout', kind: 'expense', icon: 'fork.knife', color: '#E08C5A', parentExternalId: 'c-parent', archived: false },
      { externalId: 'c-parent', name: 'Eating', kind: 'expense', icon: 'fork.knife', color: '#E08C5A', parentExternalId: null, archived: false },
      { externalId: 'c-income', name: 'Pay', kind: 'income', icon: 'banknote', color: '#3B9A69', parentExternalId: null, archived: false },
    ],
    tags: [{ externalId: 't-work', name: 'Work', color: '#6D7885' }],
    transactions: [
      { externalId: 'x-lunch', kind: 'expense', status: 'posted', title: 'Lunch', note: '', localDate: '2026-07-10', accountExternalId: 'a-cash', destinationAccountExternalId: null, categoryExternalId: 'c-child', tagExternalIds: ['t-work'], amountMinor: 500, destinationAmountMinor: null, recurringRuleExternalId: null },
      { externalId: 'x-pay', kind: 'income', status: 'posted', title: 'Pay', note: '', localDate: '2026-07-01', accountExternalId: 'a-bank', destinationAccountExternalId: null, categoryExternalId: 'c-income', tagExternalIds: [], amountMinor: 100_000, destinationAmountMinor: null, recurringRuleExternalId: null },
      { externalId: 'x-move', kind: 'transfer', status: 'posted', title: 'Top up', note: '', localDate: '2026-07-11', accountExternalId: 'a-bank', destinationAccountExternalId: 'a-cash', categoryExternalId: null, tagExternalIds: [], amountMinor: 20_000, destinationAmountMinor: 20_000, recurringRuleExternalId: null },
      { externalId: 'x-rent', kind: 'expense', status: 'upcoming', title: 'Rent', note: '', localDate: '2026-07-20', accountExternalId: 'a-cash', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 40_000, destinationAmountMinor: null, recurringRuleExternalId: 'r-rent' },
    ],
    recurringRules: [
      { externalId: 'r-rent', kind: 'expense', title: 'Rent', note: '', accountExternalId: 'a-cash', categoryExternalId: null, tagExternalIds: [], amountMinor: 40_000, currency: 'USD', unit: 'month', interval: 1, startDate: '2026-08-01', endDate: null, nextDueDate: '2026-08-01', autoPost: false, active: true },
    ],
    budgets: [
      { externalId: 'b-food', name: 'Food', icon: 'cart', color: '#5F9F78', limitMinor: 50_000, period: { unit: 'month', interval: 1, anchorDate: '2026-07-01', endDate: null }, accountExternalIds: [], categoryExternalIds: ['c-parent'], tagExternalIds: [], categoryLimits: [{ categoryExternalId: 'c-parent', limitMinor: 30_000 }], archived: false },
    ],
    report: { counts: { accounts: 2, categories: 3, tags: 1, transactions: 4, recurringRules: 1, budgets: 1 }, warnings: [], balanceChecks: [] },
    ...overrides,
  };
}

const FULL_COUNTS = { accounts: 2, categories: 3, tags: 1, transactions: 4, recurringRules: 1, budgets: 1 };
const ZERO_COUNTS = { accounts: 0, categories: 0, tags: 0, transactions: 0, recurringRules: 0, budgets: 0 };

const allRows = async (storage: StorageAdapter, type: EntityType) => storage.readAll(type);

const balances = (repository: LocalFinanceRepository) =>
  new Map(repository.getDashboard('2026-07-01', '2026-07-31').accountBalances.map((item) => [item.account.name, item.balanceMinor]));

/** Fake clock for the whole test, restored even when an assertion throws. */
async function withClock(work: () => Promise<void>) {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(NOW);
    await work();
  } finally {
    jest.useRealTimers();
  }
}

describe('importExternalBundle', () => {
  it('previews the full outcome without mutating or writing anything', async () => {
    const { repository, storage } = await createRepository();
    const before = JSON.stringify(repository.getSnapshot());
    const rowsBefore = await Promise.all((['accounts', 'categories', 'tags', 'transactions', 'budgets', 'recurringRules'] as const).map((type) => allRows(storage, type)));

    const outcome = await repository.importExternalBundle(makeBundle(), { mode: 'merge' });

    expect(outcome.committed).toBe(false);
    expect(outcome.created).toEqual(FULL_COUNTS);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.duplicateTransactions).toBe(0);
    expect(JSON.stringify(repository.getSnapshot())).toBe(before);
    const rowsAfter = await Promise.all((['accounts', 'categories', 'tags', 'transactions', 'budgets', 'recurringRules'] as const).map((type) => allRows(storage, type)));
    expect(rowsAfter).toEqual(rowsBefore);
  });

  it('commits into an empty vault with derived balances and upcoming occurrences', async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const outcome = await repository.importExternalBundle(makeBundle(), { mode: 'merge' }, true);
      expect(outcome.committed).toBe(true);
      expect(outcome.created).toEqual(FULL_COUNTS);

      const snapshot = repository.getSnapshot();
      const idOf = (type: Parameters<typeof externalImportId>[1], externalId: string) => externalImportId('cashew', type, externalId);
      expect(snapshot.accounts.map((item) => item.id)).toEqual(expect.arrayContaining([idOf('account', 'a-cash'), idOf('account', 'a-bank')]));
      const parent = snapshot.categories.find((item) => item.id === idOf('category', 'c-parent'))!;
      const child = snapshot.categories.find((item) => item.id === idOf('category', 'c-child'))!;
      expect(parent.parentId).toBeNull();
      expect(child.parentId).toBe(parent.id);
      expect(snapshot.categories.find((item) => item.id === idOf('category', 'c-income'))?.kind).toBe('income');
      expect(snapshot.tags.map((item) => item.name)).toEqual(['Work']);
      expect(snapshot.budgets).toHaveLength(1);
      expect(snapshot.budgets[0].rollover).toBe(false);
      expect(snapshot.budgets[0].filters.categoryIds).toEqual([parent.id]);
      expect(snapshot.budgetPeriods).toHaveLength(1);

      // Cash: 100.00 opening - 5.00 lunch + 200.00 top-up. Bank: 1000.00 pay - 200.00 top-up.
      // The upcoming rent is not posted, and a transfer never counts as income or expense.
      const byName = balances(repository);
      expect(byName.get('Cash')).toBe(29_500);
      expect(byName.get('Bank')).toBe(80_000);
      const summary = repository.getDashboard('2026-07-01', '2026-07-31');
      expect(summary.expenseMinor).toBe(500);
      expect(summary.incomeMinor).toBe(100_000);

      const rule = snapshot.recurringRules.find((item) => item.id === idOf('recurringRule', 'r-rent'))!;
      expect(rule.active).toBe(true);
      expect(rule.pausedByDependency).toBe(false);
      const generated = snapshot.transactions.filter((item) => item.occurrenceKey !== null);
      expect(generated.map((item) => item.localDate)).toEqual(['2026-08-01']);
      expect(generated[0].status).toBe('upcoming');
      const rent = snapshot.transactions.find((item) => item.id === idOf('transaction', 'x-rent'))!;
      expect(rent.recurringRuleId).toBe(rule.id);
      expect(rent.occurrenceKey).toBeNull();
      const lunch = snapshot.transactions.find((item) => item.id === idOf('transaction', 'x-lunch'))!;
      expect(lunch.tagIds).toEqual([snapshot.tags[0].id]);
      expect(lunch.categoryId).toBe(child.id);
    });
  });

  it('re-imports idempotently: nothing new, everything a duplicate, state unchanged', async () => {
    await withClock(async () => {
      const { repository, storage } = await createRepository();
      const bundle = makeBundle();
      await repository.importExternalBundle(bundle, { mode: 'merge' }, true);
      const snapshot = JSON.stringify(repository.getSnapshot());
      const rows = JSON.stringify(await allRows(storage, 'transactions'));

      const second = await repository.importExternalBundle(bundle, { mode: 'merge' }, true);

      expect(second.committed).toBe(true);
      expect(second.created).toEqual(ZERO_COUNTS);
      expect(second.duplicateTransactions).toBe(bundle.transactions.length);
      expect(second.reused).toEqual({ accounts: 2, categories: 3, tags: 1 });
      expect(second.rejected).toEqual([]);
      expect(JSON.stringify(repository.getSnapshot())).toBe(snapshot);
      expect(JSON.stringify(await allRows(storage, 'transactions'))).toBe(rows);
    });
  });

  it('reuses same-named compatible entities and suffixes incompatible ones', async () => {
    const { repository } = await createRepository();
    const groceries = repository.getSnapshot().categories.find((item) => item.name === 'Groceries')!;
    const everyday = repository.getSnapshot().accounts[0];
    const bundle = makeBundle({
      accounts: [
        // Same name, other currency: a different account, so it is created with a suffix.
        { externalId: 'a-ils', name: 'everyday', type: 'checking', currency: 'ILS', openingBalanceMinor: 5_000, icon: 'wallet', color: '#5966E9', archived: false },
        // Same name and currency: the vault's own account.
        { externalId: 'a-usd', name: 'Everyday', type: 'checking', currency: 'USD', openingBalanceMinor: 999, icon: 'wallet', color: '#5966E9', archived: false },
      ],
      categories: [
        { externalId: 'c-groc', name: 'groceries', kind: 'expense', icon: 'cart', color: '#5F9F78', parentExternalId: null, archived: false },
        // Same name, other kind: not the same thing.
        { externalId: 'c-groc-in', name: 'Groceries', kind: 'income', icon: 'cart', color: '#5F9F78', parentExternalId: null, archived: false },
      ],
      tags: [],
      transactions: [
        { externalId: 'x1', kind: 'expense', status: 'posted', title: 'Milk', note: '', localDate: '2026-07-10', accountExternalId: 'a-usd', destinationAccountExternalId: null, categoryExternalId: 'c-groc', tagExternalIds: [], amountMinor: 300, destinationAmountMinor: null, recurringRuleExternalId: null },
        { externalId: 'x2', kind: 'income', status: 'posted', title: 'Refund', note: '', localDate: '2026-07-10', accountExternalId: 'a-usd', destinationAccountExternalId: null, categoryExternalId: 'c-groc-in', tagExternalIds: [], amountMinor: 100, destinationAmountMinor: null, recurringRuleExternalId: null },
      ],
      recurringRules: [],
      budgets: [],
    });

    const outcome = await repository.importExternalBundle(bundle, { mode: 'merge' }, true);

    expect(outcome.reused).toEqual({ accounts: 1, categories: 1, tags: 0 });
    expect(outcome.created).toEqual({ ...ZERO_COUNTS, accounts: 1, categories: 1, transactions: 2 });
    expect(outcome.renamed).toEqual([
      { kind: 'account', from: 'everyday', to: 'everyday (Cashew)' },
      { kind: 'category', from: 'Groceries', to: 'Groceries (Cashew)' },
    ]);
    const snapshot = repository.getSnapshot();
    expect(snapshot.accounts).toHaveLength(2);
    // The reused account keeps the vault's opening balance, not the backup's.
    expect(snapshot.accounts.find((item) => item.id === everyday.id)?.openingBalanceMinor).toBe(0);
    expect(snapshot.categories.filter((item) => item.name.startsWith('Groceries'))).toHaveLength(2);
    const milk = snapshot.transactions.find((item) => item.title === 'Milk')!;
    expect(milk.accountId).toBe(everyday.id);
    expect(milk.categoryId).toBe(groceries.id);
  });

  it('rejects a posting to a reused account that is archived in the vault', async () => {
    const { repository } = await createRepository();
    const dormant = await repository.saveAccount({ name: 'Dormant', type: 'cash', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: true });
    const bundle = makeBundle({
      accounts: [{ externalId: 'a', name: 'Dormant', type: 'cash', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false }],
      categories: [], tags: [], recurringRules: [], budgets: [],
      transactions: [{ externalId: 'x', kind: 'expense', status: 'posted', title: 'Nope', note: '', localDate: '2026-07-10', accountExternalId: 'a', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 100, destinationAmountMinor: null, recurringRuleExternalId: null }],
    });
    const outcome = await repository.importExternalBundle(bundle, { mode: 'merge' });
    expect(outcome.reused.accounts).toBe(1);
    expect(outcome.rejected).toEqual([{ externalId: 'x', reason: 'Its account is archived in this vault.' }]);
    await expect(repository.importExternalBundle(bundle, { mode: 'merge' }, true)).rejects.toThrow('Import blocked: 1 item(s)');
    expect(repository.getSnapshot().transactions).toHaveLength(0);
    expect(dormant.archived).toBe(true);
  });

  it('imports an archived source account with history, keeping it archived', async () => {
    const { repository } = await createRepository();
    const bundle = makeBundle({
      accounts: [{ externalId: 'old', name: 'Old wallet', type: 'cash', currency: 'USD', openingBalanceMinor: 1_000, icon: 'wallet', color: '#5966E9', archived: true }],
      categories: [], tags: [], budgets: [],
      recurringRules: [{ externalId: 'r', kind: 'expense', title: 'Gym', note: '', accountExternalId: 'old', categoryExternalId: null, tagExternalIds: [], amountMinor: 900, currency: 'USD', unit: 'month', interval: 1, startDate: '2026-08-01', endDate: null, nextDueDate: '2026-08-01', autoPost: false, active: true }],
      transactions: [{ externalId: 'x', kind: 'expense', status: 'posted', title: 'Old lunch', note: '', localDate: '2026-07-10', accountExternalId: 'old', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 100, destinationAmountMinor: null, recurringRuleExternalId: null }],
    });
    await repository.importExternalBundle(bundle, { mode: 'merge' }, true);
    const snapshot = repository.getSnapshot();
    expect(snapshot.accounts.find((item) => item.name === 'Old wallet')?.archived).toBe(true);
    expect(snapshot.transactions).toHaveLength(1);
    // A rule on an archived account is paused by its dependency, exactly as archiving does.
    expect(snapshot.recurringRules[0]).toMatchObject({ active: false, pausedByDependency: true });
  });

  it('does not resurrect a transaction the user deleted', async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const bundle = makeBundle();
      await repository.importExternalBundle(bundle, { mode: 'merge' }, true);
      const lunchId = externalImportId('cashew', 'transaction', 'x-lunch');
      await repository.deleteEntities('transactions', [lunchId]);
      expect(repository.getSnapshot().transactions.some((item) => item.id === lunchId)).toBe(false);

      const outcome = await repository.importExternalBundle(bundle, { mode: 'merge' }, true);

      expect(outcome.created.transactions).toBe(0);
      expect(outcome.duplicateTransactions).toBe(4);
      expect(repository.getSnapshot().transactions.some((item) => item.id === lunchId)).toBe(false);
    });
  });

  it('skips a transaction that matches an existing one by content', async () => {
    const { repository } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    await repository.saveTransaction({ kind: 'expense', title: 'Coffee', localDate: '2026-07-10', accountId: everyday.id, amountMinor: 450 });
    const bundle = makeBundle({
      accounts: [{ externalId: 'a', name: 'Everyday', type: 'checking', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false }],
      categories: [], tags: [], recurringRules: [], budgets: [],
      transactions: [
        { externalId: 'x-same', kind: 'expense', status: 'posted', title: 'coffee', note: '', localDate: '2026-07-10', accountExternalId: 'a', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 450, destinationAmountMinor: null, recurringRuleExternalId: null },
        // Two genuinely separate identical purchases inside one backup are both kept.
        { externalId: 'x-tea-1', kind: 'expense', status: 'posted', title: 'Tea', note: '', localDate: '2026-07-10', accountExternalId: 'a', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 200, destinationAmountMinor: null, recurringRuleExternalId: null },
        { externalId: 'x-tea-2', kind: 'expense', status: 'posted', title: 'Tea', note: '', localDate: '2026-07-10', accountExternalId: 'a', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 200, destinationAmountMinor: null, recurringRuleExternalId: null },
      ],
    });
    const outcome = await repository.importExternalBundle(bundle, { mode: 'merge' }, true);
    expect(outcome.duplicateTransactions).toBe(1);
    expect(outcome.created.transactions).toBe(2);
    expect(repository.getSnapshot().transactions).toHaveLength(3);
  });

  it('replaces the vault atomically, tombstoning rather than deleting, and keeps settings and rates', async () => {
    await withClock(async () => {
      const { repository, storage } = await createRepository();
      const everyday = repository.getSnapshot().accounts[0];
      await repository.saveTag({ name: 'Old tag', color: '#6D7885' });
      await repository.saveTransaction({ kind: 'expense', title: 'Old', localDate: '2026-07-10', accountId: everyday.id, amountMinor: 100 });
      await repository.saveGoal({ name: 'Trip', kind: 'saving', icon: 'target', color: '#5966E9', targetMinor: 10_000, initialMinor: 0, targetDate: null, linkedAccountId: null, linkedCategoryId: null, archived: false });
      const rate = await repository.saveExchangeRate({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '2', effectiveDate: '2026-01-01' });
      const settings = repository.getSnapshot().settings;

      const preview = await repository.importExternalBundle(makeBundle(), { mode: 'replace' });
      expect(preview.replaced).toEqual({ accounts: 1, categories: 8, tags: 1, transactions: 1, recurringRules: 0, budgets: 0, goals: 1 });
      expect(repository.getSnapshot().accounts).toHaveLength(1);

      const outcome = await repository.importExternalBundle(makeBundle(), { mode: 'replace' }, true);
      expect(outcome.committed).toBe(true);
      expect(outcome.replaced).toEqual(preview.replaced);
      expect(outcome.reused).toEqual({ accounts: 0, categories: 0, tags: 0 });
      expect(outcome.created).toEqual(FULL_COUNTS);

      const snapshot = repository.getSnapshot();
      expect(snapshot.accounts.map((item) => item.name).sort()).toEqual(['Bank', 'Cash']);
      expect(snapshot.categories.map((item) => item.name).sort()).toEqual(['Eating', 'Pay', 'Takeout']);
      expect(snapshot.tags.map((item) => item.name)).toEqual(['Work']);
      expect(snapshot.goals).toEqual([]);
      expect(snapshot.transactions.some((item) => item.title === 'Old')).toBe(false);
      expect(snapshot.transactions.filter((item) => item.occurrenceKey === null)).toHaveLength(4);
      expect(snapshot.settings).toEqual(settings);
      expect(snapshot.exchangeRates.map((item) => item.id)).toEqual([rate.id]);

      // Soft deletion: the old rows are still stored, marked deleted, with their revision bumped.
      const storedAccounts = await allRows(storage, 'accounts');
      const oldAccount = storedAccounts.find((item) => item.id === everyday.id)!;
      expect(oldAccount.deletedAt).not.toBeNull();
      expect(oldAccount.revision).toBe(everyday.revision + 1);
      expect((await allRows(storage, 'goals')).every((item) => item.deletedAt !== null)).toBe(true);
      expect((await allRows(storage, 'categories')).filter((item) => item.deletedAt !== null)).toHaveLength(8);
    });
  });

  it('revives tombstoned entities that carry a derived id, bumping their revision', async () => {
    await withClock(async () => {
      const { repository, storage } = await createRepository();
      const bundle = makeBundle();
      await repository.importExternalBundle(bundle, { mode: 'replace' }, true);
      const cashId = externalImportId('cashew', 'account', 'a-cash');
      const originalRevision = (await allRows(storage, 'accounts')).find((item) => item.id === cashId)!.revision;

      const other = makeBundle({
        accounts: [{ externalId: 'z', name: 'Other', type: 'cash', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false }],
        categories: [], tags: [], transactions: [], recurringRules: [], budgets: [],
      });
      await repository.importExternalBundle(other, { mode: 'replace' }, true);
      expect(repository.getSnapshot().accounts.map((item) => item.name)).toEqual(['Other']);
      expect((await allRows(storage, 'accounts')).find((item) => item.id === cashId)?.deletedAt).not.toBeNull();

      const back = await repository.importExternalBundle(bundle, { mode: 'replace' }, true);
      expect(back.created).toEqual(FULL_COUNTS);
      const snapshot = repository.getSnapshot();
      expect(snapshot.accounts.map((item) => item.name).sort()).toEqual(['Bank', 'Cash']);
      const revived = snapshot.accounts.find((item) => item.id === cashId)!;
      expect(revived.deletedAt).toBeNull();
      expect(revived.revision).toBeGreaterThan(originalRevision + 1);
      expect(snapshot.transactions.filter((item) => item.occurrenceKey === null)).toHaveLength(4);
      // A same-id row written twice is one entity, not two.
      expect((await allRows(storage, 'accounts')).filter((item) => item.id === cashId)).toHaveLength(1);
      expect(balances(repository).get('Cash')).toBe(29_500);
    });
  });

  it('replaces an earlier replace-import in place without duplicating or tombstoning it', async () => {
    await withClock(async () => {
      const { repository, storage } = await createRepository();
      const bundle = makeBundle();
      await repository.importExternalBundle(bundle, { mode: 'replace' }, true);
      const again = await repository.importExternalBundle(bundle, { mode: 'replace' }, true);
      expect(again.created).toEqual(FULL_COUNTS);
      expect(again.replaced).toMatchObject({ accounts: 2, categories: 3, tags: 1, transactions: 5, recurringRules: 1, budgets: 1 });
      const snapshot = repository.getSnapshot();
      expect(snapshot.accounts).toHaveLength(2);
      expect(snapshot.transactions.filter((item) => item.occurrenceKey === null)).toHaveLength(4);
      expect(balances(repository).get('Cash')).toBe(29_500);
      const cash = (await allRows(storage, 'accounts')).find((item) => item.id === externalImportId('cashew', 'account', 'a-cash'))!;
      expect(cash.deletedAt).toBeNull();
      expect(cash.revision).toBe(2);
    });
  });

  it('revives a tombstoned tag in merge mode but not a deleted budget or schedule', async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const bundle = makeBundle();
      await repository.importExternalBundle(bundle, { mode: 'merge' }, true);
      const idOf = (type: Parameters<typeof externalImportId>[1], externalId: string) => externalImportId('cashew', type, externalId);
      await repository.deleteEntities('tags', [idOf('tag', 't-work')]);
      await repository.deleteEntities('budgets', [idOf('budget', 'b-food')]);
      await repository.deleteEntities('recurringRules', [idOf('recurringRule', 'r-rent')]);

      const outcome = await repository.importExternalBundle(bundle, { mode: 'merge' }, true);
      expect(outcome.rejected).toEqual([]);
      expect(outcome.created).toEqual({ ...ZERO_COUNTS, tags: 1 });
      const snapshot = repository.getSnapshot();
      expect(snapshot.tags.map((item) => item.id)).toEqual([idOf('tag', 't-work')]);
      expect(snapshot.budgets).toEqual([]);
      expect(snapshot.recurringRules).toEqual([]);
    });
  });

  it('still reports a committed import when the recurring catch-up throws afterwards', async () => {
    await withClock(async () => {
      const { repository, storage } = await createRepository();
      const spy = jest
        .spyOn(repository as unknown as { generateRecurringNow: () => Promise<void> }, 'generateRecurringNow')
        .mockRejectedValue(new Error('catch-up failed'));

      const outcome = await repository.importExternalBundle(makeBundle(), { mode: 'merge' }, true);

      expect(spy).toHaveBeenCalled();
      expect(outcome.committed).toBe(true);
      expect((await allRows(storage, 'accounts')).length).toBeGreaterThan(1);
    });
  });

  it('leaves the snapshot untouched when persistence fails', async () => {
    class FailingStorage extends MemoryStorageAdapter {
      fail = false;

      override async putMany(records: Parameters<MemoryStorageAdapter['putMany']>[0], source?: object) {
        if (this.fail) throw new Error('simulated disk failure');
        await super.putMany(records, source);
      }
    }
    const storage = new FailingStorage();
    const { repository } = await createRepository(storage);
    const before = repository.getSnapshot();
    const serialized = JSON.stringify(before);
    storage.fail = true;

    await expect(repository.importExternalBundle(makeBundle(), { mode: 'replace' }, true)).rejects.toThrow('simulated disk failure');

    expect(repository.getSnapshot()).toBe(before);
    expect(JSON.stringify(repository.getSnapshot())).toBe(serialized);
    expect((await storage.readAll('accounts')).filter((item) => item.deletedAt !== null)).toEqual([]);
    expect(await storage.readAll('transactions')).toEqual([]);
  });

  it('reports rejected records in a preview and refuses to commit or write anything', async () => {
    const { repository, storage } = await createRepository();
    const bundle = makeBundle({
      accounts: [
        { externalId: 'a-usd', name: 'Cash', type: 'cash', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false },
        { externalId: 'a-ils', name: 'Shekels', type: 'cash', currency: 'ils', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false },
      ],
      categories: [], tags: [], recurringRules: [], budgets: [],
      transactions: [
        { externalId: 'ok', kind: 'expense', status: 'posted', title: 'Fine', note: '', localDate: '2026-07-10', accountExternalId: 'a-usd', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 100, destinationAmountMinor: null, recurringRuleExternalId: null },
        { externalId: 'no-rate', kind: 'expense', status: 'posted', title: 'Foreign', note: '', localDate: '2026-07-10', accountExternalId: 'a-ils', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 100, destinationAmountMinor: null, recurringRuleExternalId: null },
      ],
    });
    const before = JSON.stringify(repository.getSnapshot());

    const preview = await repository.importExternalBundle(bundle, { mode: 'merge' });
    expect(preview.committed).toBe(false);
    expect(preview.rejected).toHaveLength(1);
    expect(preview.rejected[0].externalId).toBe('no-rate');
    expect(preview.rejected[0].reason).toContain('Missing exchange rate');

    await expect(repository.importExternalBundle(bundle, { mode: 'merge' }, true)).rejects.toThrow(
      'Import blocked: 1 item(s) could not be imported, so nothing was imported.',
    );
    expect(JSON.stringify(repository.getSnapshot())).toBe(before);
    expect(await storage.readAll('transactions')).toEqual([]);
    expect(await storage.readAll('accounts')).toHaveLength(1);
  });

  it('rejects dangling references and invalid values per record', async () => {
    const { repository } = await createRepository();
    const bundle = makeBundle({
      accounts: [
        { externalId: 'bad-currency', name: 'Bad', type: 'cash', currency: 'xx', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false },
        { externalId: 'good', name: 'Good', type: 'cash', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false },
      ],
      categories: [{ externalId: 'orphan', name: 'Orphan', kind: 'expense', icon: 'cart', color: '#5F9F78', parentExternalId: 'missing', archived: false }],
      tags: [], recurringRules: [], budgets: [],
      transactions: [
        { externalId: 'x-bad-account', kind: 'expense', status: 'posted', title: 'A', note: '', localDate: '2026-07-10', accountExternalId: 'bad-currency', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 100, destinationAmountMinor: null, recurringRuleExternalId: null },
        { externalId: 'x-bad-category', kind: 'expense', status: 'posted', title: 'B', note: '', localDate: '2026-07-10', accountExternalId: 'good', destinationAccountExternalId: null, categoryExternalId: 'orphan', tagExternalIds: [], amountMinor: 100, destinationAmountMinor: null, recurringRuleExternalId: null },
        { externalId: 'x-bad-amount', kind: 'expense', status: 'posted', title: 'C', note: '', localDate: '2026-07-10', accountExternalId: 'good', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 0, destinationAmountMinor: null, recurringRuleExternalId: null },
      ],
    });
    const outcome = await repository.importExternalBundle(bundle, { mode: 'merge' });
    expect(outcome.rejected.map((item) => item.externalId).sort()).toEqual(
      ['bad-currency', 'orphan', 'x-bad-account', 'x-bad-amount', 'x-bad-category'].sort(),
    );
  });

  it('stores integer amounts and snapshots the applied rate and base amount', async () => {
    const { repository } = await createRepository();
    await repository.saveExchangeRate({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '2', effectiveDate: '2026-01-01' });
    const bundle = makeBundle({
      accounts: [
        { externalId: 'usd', name: 'Cash', type: 'cash', currency: 'USD', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false },
        { externalId: 'eur', name: 'Euro', type: 'cash', currency: 'EUR', openingBalanceMinor: 0, icon: 'wallet', color: '#5966E9', archived: false },
      ],
      categories: [], tags: [], recurringRules: [], budgets: [],
      transactions: [
        { externalId: 'x-eur', kind: 'expense', status: 'posted', title: 'Coffee', note: '', localDate: '2026-07-10', accountExternalId: 'eur', destinationAccountExternalId: null, categoryExternalId: null, tagExternalIds: [], amountMinor: 1_000, destinationAmountMinor: null, recurringRuleExternalId: null },
        { externalId: 'x-xfer', kind: 'transfer', status: 'posted', title: 'Convert', note: '', localDate: '2026-07-11', accountExternalId: 'usd', destinationAccountExternalId: 'eur', categoryExternalId: null, tagExternalIds: [], amountMinor: 2_000, destinationAmountMinor: 1_000, recurringRuleExternalId: null },
      ],
    });
    const outcome = await repository.importExternalBundle(bundle, { mode: 'merge' }, true);
    expect(outcome.rejected).toEqual([]);
    const transactions = repository.getSnapshot().transactions;
    expect(transactions).toHaveLength(2);
    for (const item of transactions) {
      expect(Number.isSafeInteger(item.amountMinor)).toBe(true);
      expect(Number.isSafeInteger(item.baseAmountMinor)).toBe(true);
      expect(typeof item.exchangeRate).toBe('string');
    }
    const eur = transactions.find((item) => item.title === 'Coffee')!;
    expect(eur.exchangeRate).toBe('2');
    expect(eur.baseAmountMinor).toBe(2_000);
    const transfer = transactions.find((item) => item.kind === 'transfer')!;
    expect(transfer.destinationAmountMinor).toBe(1_000);
    expect(transfer.destinationBaseAmountMinor).toBe(2_000);
    expect(transfer.transferGroupId).toBe(externalImportId('cashew', 'transfer-group', 'x-xfer'));
  });

  it('derives identical ids in two separate repositories', async () => {
    await withClock(async () => {
      const first = (await createRepository()).repository;
      const second = (await createRepository()).repository;
      const bundle = makeBundle();
      await first.importExternalBundle(bundle, { mode: 'merge' }, true);
      await second.importExternalBundle(bundle, { mode: 'merge' }, true);
      const ids = (repository: LocalFinanceRepository) => {
        const snapshot = repository.getSnapshot();
        return [
          ...snapshot.accounts.filter((item) => item.name !== 'Everyday'),
          ...snapshot.categories.filter((item) => ['Eating', 'Takeout', 'Pay'].includes(item.name)),
          ...snapshot.tags,
          ...snapshot.transactions,
          ...snapshot.budgets,
          ...snapshot.recurringRules,
        ].map((item) => item.id).sort();
      };
      expect(ids(first)).toEqual(ids(second));
      expect(ids(first)).toHaveLength(2 + 3 + 1 + 5 + 1 + 1);
    });
  });

  it('captures delete and restore ops for a replace when sync is armed', async () => {
    await withClock(async () => {
      const inner = new MemoryStorageAdapter();
      const syncing = new SyncingStorageAdapter(inner, DEVICE_A);
      const { repository } = await createRepository(syncing);
      const everyday = repository.getSnapshot().accounts[0];
      const readOps = async () => (await syncing.transact((tx) => tx.table('syncOps').all())).map((row) => `${row.entityType}:${row.kind}:${row.entityId}`);
      const bundle = makeBundle();

      await repository.importExternalBundle(bundle, { mode: 'replace' }, true);
      const afterFirst = await readOps();
      expect(afterFirst).toContain(`accounts:delete:${everyday.id}`);
      expect(afterFirst).toContain(`accounts:create:${externalImportId('cashew', 'account', 'a-cash')}`);
      expect(afterFirst).toContain(`transactions:create:${externalImportId('cashew', 'transaction', 'x-lunch')}`);

      const other = makeBundle({ accounts: [], categories: [], tags: [], transactions: [], recurringRules: [], budgets: [] });
      await repository.importExternalBundle(other, { mode: 'replace' }, true);
      await repository.importExternalBundle(bundle, { mode: 'replace' }, true);
      const afterBack = await readOps();
      expect(afterBack).toContain(`accounts:restore:${externalImportId('cashew', 'account', 'a-cash')}`);
      expect(afterBack).toContain(`transactions:restore:${externalImportId('cashew', 'transaction', 'x-lunch')}`);
    });
  });
});
