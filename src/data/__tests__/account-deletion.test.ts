/**
 * Deleting erases: an account goes with what was booked on it, and nothing is archived.
 *
 * Covers the account delete rules (transactions, schedules, converted transfers, budgets, goals),
 * the one-time sweep of data an older version archived, and the pure impact helper the
 * confirmation dialog reads.
 */

import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type {
  AccountInput,
  BudgetInput,
  RecurringInput,
} from "@/data/repository";
import type {
  EntityType,
  FinanceEntity,
  TransactionRecord,
} from "@/domain/models";
import { eraseEntity } from "@/domain/erasure";
import {
  accountDeletionImpact,
  accountDeletionMessage,
} from "@/utils/account-impact";

async function createRepository(
  storage = new MemoryStorageAdapter(),
  options: { sweeps?: boolean } = {},
) {
  const repository = new LocalFinanceRepository(storage);
  // A repository that does not sweep stands in for the older build that archived the data.
  await repository.initialize({ generateRecurring: options.sweeps ?? true });
  await repository.completeOnboarding({
    locale: "en-US",
    baseCurrency: "USD",
    accountName: "Everyday",
    accountType: "checking",
    openingBalanceMinor: 0,
    themeMode: "system",
    accentSource: "system",
    accentHex: "#5966E9",
  });
  return { repository, storage };
}

const at = (iso: string) => jest.setSystemTime(new Date(`${iso}T09:00:00Z`));

const accountInput = (overrides: Partial<AccountInput> = {}): AccountInput => ({
  name: "Second",
  type: "checking",
  currency: "USD",
  openingBalanceMinor: 0,
  icon: "wallet.bifold",
  color: "#123456",
  archived: false,
  ...overrides,
});

const monthly = (overrides: Partial<BudgetInput> = {}): BudgetInput => ({
  name: "Monthly",
  icon: "chart",
  color: "#5966E9",
  limitMinor: 1000,
  period: {
    unit: "month",
    interval: 1,
    anchorDate: "2026-06-01",
    endDate: null,
  },
  rollover: false,
  filters: { accountIds: [], categoryIds: [], tagIds: [] },
  categoryLimits: [],
  archived: false,
  ...overrides,
});

const rule = (
  accountId: string,
  overrides: Partial<RecurringInput> = {},
): RecurringInput => ({
  template: {
    kind: "expense",
    title: "Rent",
    note: "",
    accountId,
    categoryId: null,
    tagIds: [],
    amountMinor: 100,
    currency: "USD",
  },
  unit: "month",
  interval: 1,
  startDate: "2026-08-10",
  endDate: null,
  nextDueDate: "2026-08-10",
  autoPost: false,
  active: true,
  ...overrides,
});

const goalInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Trip",
  kind: "saving" as const,
  icon: "airplane",
  color: "#5966E9",
  targetMinor: 10000,
  initialMinor: 0,
  targetDate: null,
  linkedAccountId: null,
  linkedCategoryId: null,
  archived: false,
  ...overrides,
});

const expenseCategory = (name: string) => ({
  name,
  kind: "expense" as const,
  color: "#36A852",
  icon: "cart",
  parentId: null,
  archived: false,
});

const stored = async <T extends FinanceEntity>(
  storage: MemoryStorageAdapter,
  type: EntityType,
  id: string,
) => (await storage.readAll(type)).find((item) => item.id === id) as T;

const balanceOf = (repository: LocalFinanceRepository, accountId: string) =>
  repository
    .getDashboard("2026-01-01", "2026-12-31")
    .accountBalances.find((item) => item.account.id === accountId)!
    .balanceMinor;

/** Writes `patch` straight into storage: how data an older build archived is simulated. */
async function patchStored(
  storage: MemoryStorageAdapter,
  type: EntityType,
  id: string,
  patch: Record<string, unknown>,
) {
  const row = await stored<FinanceEntity>(storage, type, id);
  await storage.putMany([
    { type, entity: { ...row, ...patch } as FinanceEntity },
  ]);
}

beforeEach(() => {
  jest.useFakeTimers();
  at("2026-08-10");
});
afterEach(() => jest.useRealTimers());

describe("deleting an account", () => {
  it("tombstones its transactions and schedules, erased like every other deletion", async () => {
    const { repository, storage } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    const doomed = await repository.saveAccount(
      accountInput({ name: "Doomed", openingBalanceMinor: 5000 }),
    );
    const expense = await repository.saveTransaction({
      kind: "expense",
      title: "Lunch",
      note: "private",
      localDate: "2026-08-01",
      accountId: doomed.id,
      amountMinor: 900,
    });
    const income = await repository.saveTransaction({
      kind: "income",
      title: "Pay",
      localDate: "2026-08-02",
      accountId: doomed.id,
      amountMinor: 3000,
    });
    const kept = await repository.saveTransaction({
      kind: "expense",
      title: "Elsewhere",
      localDate: "2026-08-02",
      accountId: everyday.id,
      amountMinor: 100,
    });
    const schedule = await repository.saveRecurringRule(rule(doomed.id));
    // The generated occurrence waiting for review goes with the schedule.
    await repository.generateRecurring("2026-08-10");
    const upcoming = repository
      .getSnapshot()
      .transactions.filter((item) => item.recurringRuleId === schedule.id);
    expect(upcoming).toHaveLength(1);

    await repository.deleteEntities("accounts", [doomed.id]);

    const snapshot = repository.getSnapshot();
    expect(snapshot.accounts.map((item) => item.id)).toEqual([everyday.id]);
    expect(snapshot.transactions.map((item) => item.id)).toEqual([kept.id]);
    expect(snapshot.recurringRules).toEqual([]);

    // Each tombstone is exactly the erased form `erasure.ts` lists.
    const account = await stored<FinanceEntity & { currency: string }>(
      storage,
      "accounts",
      doomed.id,
    );
    expect(account.deletedAt).not.toBeNull();
    expect(account).toMatchObject({
      name: "",
      openingBalanceMinor: 0,
      currency: "USD",
      archived: false,
    });
    for (const id of [expense.id, income.id, upcoming[0].id]) {
      const row = await stored<TransactionRecord>(storage, "transactions", id);
      expect(row.deletedAt).not.toBeNull();
      expect(row).toMatchObject({
        title: "",
        note: "",
        accountId: "",
        amountMinor: 0,
        baseAmountMinor: 0,
        recurringRuleId: null,
      });
      expect(row).toEqual(eraseEntity("transactions", row));
    }
    const ruleRow = await stored<FinanceEntity>(
      storage,
      "recurringRules",
      schedule.id,
    );
    expect(ruleRow.deletedAt).not.toBeNull();
    expect(ruleRow).toEqual(eraseEntity("recurringRules", ruleRow));
    expect(ruleRow).toMatchObject({ active: false });

    // The deleted occurrence is not generated again.
    await repository.generateRecurring("2026-09-10");
    expect(repository.getSnapshot().transactions).toHaveLength(1);
  });

  it("removes linked goal contributions with the transactions that fed them", async () => {
    const { repository } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    const doomed = await repository.saveAccount(accountInput());
    const booked = await repository.saveTransaction({
      kind: "expense",
      title: "Gift",
      localDate: "2026-08-01",
      accountId: doomed.id,
      amountMinor: 500,
    });
    const goal = await repository.saveGoal(goalInput());
    await repository.saveContribution({
      goalId: goal.id,
      amountMinor: 500,
      localDate: "2026-08-01",
      transactionId: booked.id,
      note: "",
    });
    await repository.deleteEntities("accounts", [doomed.id]);
    expect(repository.getSnapshot().contributions).toEqual([]);
    expect(repository.getSnapshot().accounts[0].id).toBe(everyday.id);
  });

  it("refuses to delete the last account", async () => {
    const { repository } = await createRepository();
    const only = repository.getSnapshot().accounts[0];
    await expect(
      repository.deleteEntities("accounts", [only.id]),
    ).rejects.toThrow("Keep at least one account");
    expect(repository.getSnapshot().accounts).toHaveLength(1);
    // Nor both at once.
    const other = await repository.saveAccount(accountInput());
    await expect(
      repository.deleteEntities("accounts", [only.id, other.id]),
    ).rejects.toThrow("Keep at least one account");
    expect(repository.getSnapshot().accounts).toHaveLength(2);
  });

  it("keeps the other side of a same-currency transfer as income or expense", async () => {
    const { repository, storage } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    const doomed = await repository.saveAccount(
      accountInput({ name: "Doomed", openingBalanceMinor: 10_000 }),
    );
    await repository.saveTransaction({
      kind: "income",
      title: "Seed",
      localDate: "2026-08-01",
      accountId: everyday.id,
      amountMinor: 50_000,
    });
    const inbound = await repository.saveTransaction({
      kind: "transfer",
      title: "Top up",
      note: "from savings",
      localDate: "2026-08-02",
      accountId: doomed.id,
      destinationAccountId: everyday.id,
      amountMinor: 2_500,
    });
    const outbound = await repository.saveTransaction({
      kind: "transfer",
      title: "Pay back",
      localDate: "2026-08-03",
      accountId: everyday.id,
      destinationAccountId: doomed.id,
      amountMinor: 700,
    });
    const before = balanceOf(repository, everyday.id);
    expect(before).toBe(50_000 + 2_500 - 700);

    await repository.deleteEntities("accounts", [doomed.id]);

    const byId = (id: string) =>
      repository.getSnapshot().transactions.find((item) => item.id === id)!;
    // Transfer X→Y becomes income on Y of what arrived, same id, every transfer field cleared.
    expect(byId(inbound.id)).toMatchObject({
      kind: "income",
      accountId: everyday.id,
      amountMinor: 2_500,
      currency: "USD",
      exchangeRate: "1",
      baseAmountMinor: 2_500,
      destinationAccountId: null,
      destinationAmountMinor: null,
      destinationBaseAmountMinor: null,
      destinationCurrency: null,
      transferGroupId: null,
      categoryId: null,
      foreign: null,
      fee: null,
      status: "posted",
      title: "Top up",
      note: "from savings",
      localDate: "2026-08-02",
    });
    // Transfer Y→X becomes an expense on Y of what left.
    expect(byId(outbound.id)).toMatchObject({
      kind: "expense",
      accountId: everyday.id,
      amountMinor: 700,
      baseAmountMinor: 700,
      destinationAccountId: null,
      destinationAmountMinor: null,
      transferGroupId: null,
    });
    // The surviving account's balance does not move.
    expect(balanceOf(repository, everyday.id)).toBe(before);

    // Written as live rows, not tombstones.
    expect(
      (await stored<TransactionRecord>(storage, "transactions", inbound.id))
        .deletedAt,
    ).toBeNull();
  });

  it("converts a cross-currency transfer at the amount and base value of the surviving leg", async () => {
    const { repository } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    const euro = await repository.saveAccount(
      accountInput({ name: "Euro", currency: "EUR" }),
    );
    const pounds = await repository.saveAccount(
      accountInput({ name: "Pounds", currency: "GBP" }),
    );
    await repository.saveExchangeRate({
      fromCurrency: "EUR",
      toCurrency: "USD",
      rate: "2",
      effectiveDate: "2026-01-01",
    });
    await repository.saveExchangeRate({
      fromCurrency: "GBP",
      toCurrency: "USD",
      rate: "4",
      effectiveDate: "2026-01-01",
    });
    // EUR 100.00 -> GBP 50.00, worth 200.00 USD on both legs.
    const toPounds = await repository.saveTransaction({
      kind: "transfer",
      title: "To pounds",
      localDate: "2026-08-02",
      accountId: euro.id,
      destinationAccountId: pounds.id,
      amountMinor: 10_000,
    });
    expect(toPounds).toMatchObject({
      destinationAmountMinor: 5_000,
      baseAmountMinor: 20_000,
      destinationBaseAmountMinor: 20_000,
    });
    const fromPounds = await repository.saveTransaction({
      kind: "transfer",
      title: "From pounds",
      localDate: "2026-08-03",
      accountId: pounds.id,
      destinationAccountId: euro.id,
      amountMinor: 1_000,
    });
    expect(fromPounds.destinationAmountMinor).toBe(2_000);
    const toEuro = await repository.saveTransaction({
      kind: "transfer",
      title: "Cash to euro",
      localDate: "2026-08-04",
      accountId: everyday.id,
      destinationAccountId: euro.id,
      amountMinor: 3_000,
    });
    const poundsBefore = balanceOf(repository, pounds.id);
    const everydayBefore = balanceOf(repository, everyday.id);

    // Delete the euro account: pounds keeps both its legs, everyday keeps its outflow.
    await repository.deleteEntities("accounts", [euro.id]);

    const byId = (id: string) =>
      repository.getSnapshot().transactions.find((item) => item.id === id)!;
    expect(byId(toPounds.id)).toMatchObject({
      kind: "income",
      accountId: pounds.id,
      amountMinor: 5_000,
      currency: "GBP",
      baseAmountMinor: 20_000,
      // The rate the surviving leg was valued at: 200.00 USD for 50.00 GBP.
      exchangeRate: "4",
      destinationAccountId: null,
      destinationCurrency: null,
      destinationAmountMinor: null,
      destinationBaseAmountMinor: null,
      transferGroupId: null,
    });
    expect(byId(fromPounds.id)).toMatchObject({
      kind: "expense",
      accountId: pounds.id,
      amountMinor: 1_000,
      currency: "GBP",
      destinationAccountId: null,
    });
    expect(byId(toEuro.id)).toMatchObject({
      kind: "expense",
      accountId: everyday.id,
      amountMinor: 3_000,
      currency: "USD",
    });
    expect(balanceOf(repository, pounds.id)).toBe(poundsBefore);
    expect(balanceOf(repository, everyday.id)).toBe(everydayBefore);
  });

  it("deletes a transfer between two deleted accounts, and removes a deleted account from budgets and goals", async () => {
    const { repository } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    const first = await repository.saveAccount(accountInput({ name: "First" }));
    const second = await repository.saveAccount(
      accountInput({ name: "Second" }),
    );
    const between = await repository.saveTransaction({
      kind: "transfer",
      title: "Shuffle",
      localDate: "2026-08-02",
      accountId: first.id,
      destinationAccountId: second.id,
      amountMinor: 100,
    });
    const both = await repository.saveBudget(
      monthly({
        name: "Two accounts",
        filters: {
          accountIds: [first.id, everyday.id],
          categoryIds: [],
          tagIds: [],
        },
      }),
    );
    const onlyFirst = await repository.saveBudget(
      monthly({
        name: "Only first",
        filters: { accountIds: [first.id], categoryIds: [], tagIds: [] },
      }),
    );
    const goal = await repository.saveGoal(
      goalInput({ linkedAccountId: first.id }),
    );

    await repository.deleteEntities("accounts", [first.id, second.id]);

    const snapshot = repository.getSnapshot();
    expect(
      snapshot.transactions.find((item) => item.id === between.id),
    ).toBeUndefined();
    const budget = (id: string) =>
      snapshot.budgets.find((item) => item.id === id)!;
    expect(budget(both.id).filters.accountIds).toEqual([everyday.id]);
    // Emptied, the budget is kept and covers all spending. It is never archived.
    expect(budget(onlyFirst.id)).toMatchObject({
      archived: false,
      deletedAt: null,
      filters: { accountIds: [], categoryIds: [], tagIds: [] },
    });
    expect(snapshot.goals.find((item) => item.id === goal.id)).toMatchObject({
      linkedAccountId: null,
      archived: false,
    });
  });

  it("keeps a category-filtered budget unfiltered, not archived, when its last category goes", async () => {
    const { repository } = await createRepository();
    const category = await repository.saveCategory(expenseCategory("Pets"));
    const budget = await repository.saveBudget(
      monthly({
        filters: { accountIds: [], categoryIds: [category.id], tagIds: [] },
      }),
    );
    await repository.deleteEntities("categories", [category.id]);
    expect(
      repository.getSnapshot().budgets.find((item) => item.id === budget.id),
    ).toMatchObject({
      archived: false,
      filters: { accountIds: [], categoryIds: [], tagIds: [] },
    });
  });

  it("refuses to archive anything, so nothing can be flagged archived", async () => {
    const { repository } = await createRepository();
    await expect(
      repository.saveAccount(accountInput({ archived: true })),
    ).rejects.toThrow("Nothing can be archived");
    await expect(
      repository.saveCategory({ ...expenseCategory("X"), archived: true }),
    ).rejects.toThrow("Nothing can be archived");
    await expect(
      repository.saveBudget(monthly({ archived: true })),
    ).rejects.toThrow("Nothing can be archived");
    await expect(
      repository.saveGoal(goalInput({ archived: true })),
    ).rejects.toThrow("Nothing can be archived");
  });

  it("applies the whole deletion in one write", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage);
    const everyday = repository.getSnapshot().accounts[0];
    const doomed = await repository.saveAccount(accountInput());
    await repository.saveTransaction({
      kind: "transfer",
      title: "Out",
      localDate: "2026-08-02",
      accountId: doomed.id,
      destinationAccountId: everyday.id,
      amountMinor: 100,
    });
    const putMany = jest.spyOn(storage, "putMany");
    await repository.deleteEntities("accounts", [doomed.id]);
    expect(putMany).toHaveBeenCalledTimes(1);

    // And a failing write leaves the snapshot untouched.
    const second = await repository.saveAccount(
      accountInput({ name: "Third" }),
    );
    await repository.saveTransaction({
      kind: "expense",
      title: "Keep me",
      localDate: "2026-08-02",
      accountId: second.id,
      amountMinor: 100,
    });
    const snapshotBefore = repository.getSnapshot();
    putMany.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      repository.deleteEntities("accounts", [second.id]),
    ).rejects.toThrow("disk full");
    expect(repository.getSnapshot()).toBe(snapshotBefore);
  });
});

describe("account deletion impact", () => {
  it("counts what is deleted and names the accounts that receive converted transfers", async () => {
    const { repository } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    const doomed = await repository.saveAccount(
      accountInput({ name: "Doomed" }),
    );
    await repository.saveTransaction({
      kind: "expense",
      title: "A",
      localDate: "2026-08-01",
      accountId: doomed.id,
      amountMinor: 1,
    });
    await repository.saveTransaction({
      kind: "transfer",
      title: "B",
      localDate: "2026-08-01",
      accountId: doomed.id,
      destinationAccountId: everyday.id,
      amountMinor: 5,
    });
    await repository.saveRecurringRule(rule(doomed.id));
    await repository.saveBudget(
      monthly({
        name: "Doomed only",
        filters: { accountIds: [doomed.id], categoryIds: [], tagIds: [] },
      }),
    );

    const state = repository.getSnapshot();
    // The expense, plus the schedule's upcoming occurrence.
    expect(accountDeletionImpact(state, [doomed.id])).toMatchObject({
      transactionCount: 2,
      scheduleCount: 1,
      conversions: [
        { accountId: everyday.id, accountName: "Everyday", count: 1 },
      ],
      hasBudgetsOrGoals: true,
    });
    const message = accountDeletionMessage(state, [doomed.id]);
    expect(message).toEqual(
      expect.arrayContaining([
        "Deletes 2 transactions.",
        "Deletes 1 recurring schedule.",
        "Transfers with an account that stays are kept as income or expense there: Everyday (1).",
        "The budget “Doomed only” would then cover all your spending.",
      ]),
    );
    expect(message.join(" ")).not.toMatch(/stay in your history|archiv/i);
    // The plan describes what the repository then does.
    await repository.deleteEntities("accounts", [doomed.id]);
    expect(repository.getSnapshot().transactions).toHaveLength(1);
  });
});

describe("sweeping data an older version archived", () => {
  /** A vault holding one of each archived thing, written the way an older build left it. */
  async function archivedVault() {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage, { sweeps: false });
    const everyday = repository.getSnapshot().accounts[0];
    const old = await repository.saveAccount(accountInput({ name: "Old" }));
    const category = await repository.saveCategory(
      expenseCategory("Old category"),
    );
    const onOld = await repository.saveTransaction({
      kind: "expense",
      title: "On old",
      localDate: "2026-08-01",
      accountId: old.id,
      amountMinor: 400,
    });
    const transfer = await repository.saveTransaction({
      kind: "transfer",
      title: "Old to everyday",
      localDate: "2026-08-02",
      accountId: old.id,
      destinationAccountId: everyday.id,
      amountMinor: 900,
    });
    const categorised = await repository.saveTransaction({
      kind: "expense",
      title: "Categorised",
      localDate: "2026-08-03",
      accountId: everyday.id,
      categoryId: category.id,
      amountMinor: 250,
    });
    const oldRule = await repository.saveRecurringRule(rule(old.id));
    const categoryRule = await repository.saveRecurringRule(
      rule(everyday.id, {
        template: {
          kind: "expense",
          title: "Gym",
          note: "",
          accountId: everyday.id,
          categoryId: category.id,
          tagIds: [],
          amountMinor: 50,
          currency: "USD",
        },
      }),
    );
    const budget = await repository.saveBudget(monthly({ name: "Old budget" }));
    const goal = await repository.saveGoal(goalInput({ name: "Old goal" }));
    await repository.saveContribution({
      goalId: goal.id,
      amountMinor: 100,
      localDate: "2026-08-01",
      transactionId: null,
      note: "",
    });
    // What archiving did: flags, and schedules paused by the dependency.
    await patchStored(storage, "accounts", old.id, { archived: true });
    await patchStored(storage, "categories", category.id, { archived: true });
    await patchStored(storage, "budgets", budget.id, { archived: true });
    await patchStored(storage, "goals", goal.id, { archived: true });
    for (const id of [oldRule.id, categoryRule.id])
      await patchStored(storage, "recurringRules", id, {
        active: false,
        pausedByDependency: true,
      });
    return {
      storage,
      everyday,
      old,
      category,
      onOld,
      transfer,
      categorised,
      oldRule,
      categoryRule,
      budget,
      goal,
    };
  }

  it("deletes archived accounts, categories, budgets and goals for real at startup", async () => {
    const vault = await archivedVault();
    const repository = new LocalFinanceRepository(vault.storage);
    await repository.initialize();

    const snapshot = repository.getSnapshot();
    expect(snapshot.accounts.map((item) => item.id)).toEqual([
      vault.everyday.id,
    ]);
    expect(snapshot.categories.map((item) => item.id)).not.toContain(
      vault.category.id,
    );
    expect(snapshot.budgets).toEqual([]);
    expect(snapshot.goals).toEqual([]);
    expect(snapshot.contributions).toEqual([]);
    // The transaction on the archived account is gone; its transfer is kept on the live side.
    const ids = snapshot.transactions.map((item) => item.id);
    expect(ids).not.toContain(vault.onOld.id);
    expect(
      snapshot.transactions.find((item) => item.id === vault.transfer.id),
    ).toMatchObject({
      kind: "income",
      accountId: vault.everyday.id,
      amountMinor: 900,
    });
    // An archived category's transactions are uncategorized.
    expect(
      snapshot.transactions.find((item) => item.id === vault.categorised.id),
    ).toMatchObject({ categoryId: null });
    // The schedule on the deleted account is deleted; the one that lost its category stays
    // paused, as an ordinary paused schedule, and is never resumed.
    expect(snapshot.recurringRules.map((item) => item.id)).toEqual([
      vault.categoryRule.id,
    ]);
    expect(snapshot.recurringRules[0]).toMatchObject({
      active: false,
      pausedByDependency: false,
      template: expect.objectContaining({ categoryId: null }),
    });
    // Erased, not archived.
    for (const [type, id] of [
      ["accounts", vault.old.id],
      ["categories", vault.category.id],
      ["budgets", vault.budget.id],
      ["goals", vault.goal.id],
    ] as const) {
      const row = await stored<FinanceEntity & { archived: boolean }>(
        vault.storage,
        type,
        id,
      );
      expect(row.deletedAt).not.toBeNull();
      expect(row.archived).toBe(false);
    }

    // Still paused after generation and another launch.
    await repository.generateRecurring("2026-12-31");
    expect(repository.getSnapshot().recurringRules[0].active).toBe(false);
    const again = new LocalFinanceRepository(vault.storage);
    await again.initialize();
    expect(again.getSnapshot().recurringRules[0].active).toBe(false);
  });

  it("is idempotent: a second sweep writes nothing", async () => {
    const vault = await archivedVault();
    const repository = new LocalFinanceRepository(vault.storage);
    await repository.initialize();
    const after = repository.getSnapshot();
    const putMany = jest.spyOn(vault.storage, "putMany");
    const second = new LocalFinanceRepository(vault.storage);
    await second.initialize();
    await repository.refresh();
    expect(putMany).not.toHaveBeenCalled();
    expect(second.getSnapshot().accounts).toEqual(after.accounts);
    expect(second.getSnapshot().transactions).toEqual(after.transactions);
  });

  it("gives two devices sweeping the same data the same result", async () => {
    const vault = await archivedVault();
    const copy = new MemoryStorageAdapter();
    await copy.initialize();
    const types: EntityType[] = [
      "settings",
      "accounts",
      "categories",
      "tags",
      "transactions",
      "budgets",
      "budgetPeriods",
      "budgetAdjustments",
      "goals",
      "contributions",
      "recurringRules",
      "exchangeRates",
    ];
    for (const type of types)
      await copy.putMany(
        (await vault.storage.readAll(type)).map((entity) => ({ type, entity })),
      );
    const first = new LocalFinanceRepository(vault.storage);
    const second = new LocalFinanceRepository(copy);
    await first.initialize();
    await second.initialize();
    const strip = (state: ReturnType<typeof first.getSnapshot>) =>
      JSON.parse(
        JSON.stringify({
          accounts: state.accounts,
          categories: state.categories,
          transactions: state.transactions,
          recurringRules: state.recurringRules,
          budgets: state.budgets,
          goals: state.goals,
        }),
        (key, value) =>
          key === "updatedAt" || key === "revision" ? undefined : value,
      );
    expect(strip(first.getSnapshot())).toEqual(strip(second.getSnapshot()));
  });

  it("keeps the last account, un-archived, instead of deleting it", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage, { sweeps: false });
    const only = repository.getSnapshot().accounts[0];
    const pausedRule = await repository.saveRecurringRule(rule(only.id));
    await patchStored(storage, "accounts", only.id, { archived: true });
    await patchStored(storage, "recurringRules", pausedRule.id, {
      active: false,
      pausedByDependency: true,
    });

    const reopened = new LocalFinanceRepository(storage);
    await reopened.initialize();
    expect(reopened.getSnapshot().accounts).toHaveLength(1);
    expect(reopened.getSnapshot().accounts[0]).toMatchObject({
      id: only.id,
      archived: false,
    });
    // Its schedule is not resumed.
    expect(reopened.getSnapshot().recurringRules[0]).toMatchObject({
      active: false,
      pausedByDependency: false,
    });
  });

  it("keeps the oldest of several archived accounts when none is live", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage, { sweeps: false });
    const first = repository.getSnapshot().accounts[0];
    at("2026-08-11");
    const second = await repository.saveAccount(
      accountInput({ name: "Later" }),
    );
    for (const id of [first.id, second.id])
      await patchStored(storage, "accounts", id, { archived: true });
    const reopened = new LocalFinanceRepository(storage);
    await reopened.initialize();
    expect(reopened.getSnapshot().accounts.map((item) => item.id)).toEqual([
      first.id,
    ]);
    expect(reopened.getSnapshot().accounts[0].archived).toBe(false);
  });

  it("does not run in a headless read-only initialization", async () => {
    const vault = await archivedVault();
    const putMany = jest.spyOn(vault.storage, "putMany");
    const headless = new LocalFinanceRepository(vault.storage);
    await headless.initialize({ generateRecurring: false });
    await headless.refresh();
    expect(putMany).not.toHaveBeenCalled();
    expect(headless.getSnapshot().accounts.some((item) => item.archived)).toBe(
      true,
    );
  });

  it("sweeps records that arrive archived after a refresh", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage);
    const everyday = repository.getSnapshot().accounts[0];
    const peerCategory = await repository.saveCategory(
      expenseCategory("From peer"),
    );
    // Another tab, or an older peer's merged records, wrote it archived.
    await patchStored(storage, "categories", peerCategory.id, {
      archived: true,
    });
    await repository.refresh();
    expect(
      repository
        .getSnapshot()
        .categories.some((item) => item.id === peerCategory.id),
    ).toBe(false);
    expect(repository.getSnapshot().accounts[0].id).toBe(everyday.id);
  });
});
