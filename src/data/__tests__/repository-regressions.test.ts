import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type {
  AccountInput,
  BudgetInput,
  RecurringInput,
} from "@/data/repository";
import { fetchedRateId } from "@/utils/deterministic-id";

async function createRepository(storage = new MemoryStorageAdapter()) {
  const repository = new LocalFinanceRepository(storage);
  await repository.initialize();
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

const rentRule = (
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
  startDate: "2026-08-01",
  endDate: null,
  nextDueDate: "2026-08-01",
  autoPost: false,
  active: true,
  ...overrides,
});

describe("recurring rules paused by an archived dependency", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-07-15");
  });
  afterEach(() => jest.useRealTimers());

  it("keeps the pause through an unrelated edit and reactivates on unarchive", async () => {
    const { repository } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    await repository.saveAccount(accountInput());
    const archiveEveryday = (archived: boolean) =>
      repository.saveAccount(
        {
          name: everyday.name,
          type: everyday.type,
          currency: everyday.currency,
          openingBalanceMinor: everyday.openingBalanceMinor,
          icon: everyday.icon,
          color: everyday.color,
          archived,
        },
        everyday.id,
      );
    const ruleById = (id: string) =>
      repository.getSnapshot().recurringRules.find((item) => item.id === id)!;

    const rule = await repository.saveRecurringRule(rentRule(everyday.id));
    expect(rule.active).toBe(true);

    await archiveEveryday(true);
    const paused = ruleById(rule.id);
    expect(paused).toMatchObject({ active: false, pausedByDependency: true });

    // The form reopens the paused rule as inactive; only the title changes.
    await repository.saveRecurringRule(
      {
        ...paused,
        template: { ...paused.template, title: "Rent 2" },
        active: false,
      },
      rule.id,
    );
    expect(ruleById(rule.id)).toMatchObject({
      active: false,
      pausedByDependency: true,
      template: expect.objectContaining({ title: "Rent 2" }),
    });

    // Switching it on while the account is still archived cannot activate it.
    await repository.saveRecurringRule(
      { ...ruleById(rule.id), active: true },
      rule.id,
    );
    expect(ruleById(rule.id)).toMatchObject({
      active: false,
      pausedByDependency: true,
    });

    await archiveEveryday(false);
    expect(ruleById(rule.id)).toMatchObject({
      active: true,
      pausedByDependency: false,
    });
  });

  it("clears the pause on an edit once nothing archived blocks the rule", async () => {
    const { repository } = await createRepository();
    const everyday = repository.getSnapshot().accounts[0];
    const second = await repository.saveAccount(accountInput());
    const rule = await repository.saveRecurringRule(rentRule(everyday.id));
    await repository.saveAccount(
      {
        name: everyday.name,
        type: everyday.type,
        currency: everyday.currency,
        openingBalanceMinor: everyday.openingBalanceMinor,
        icon: everyday.icon,
        color: everyday.color,
        archived: true,
      },
      everyday.id,
    );
    expect(
      repository
        .getSnapshot()
        .recurringRules.find((item) => item.id === rule.id),
    ).toMatchObject({ pausedByDependency: true });

    // Moving the rule to a live account is an edit that removes the blocker.
    const paused = repository
      .getSnapshot()
      .recurringRules.find((item) => item.id === rule.id)!;
    await repository.saveRecurringRule(
      {
        ...paused,
        template: { ...paused.template, accountId: second.id },
        active: true,
      },
      rule.id,
    );
    expect(
      repository
        .getSnapshot()
        .recurringRules.find((item) => item.id === rule.id),
    ).toMatchObject({ active: true, pausedByDependency: false });
  });
});

describe("deleting a category used by a budget filter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-15");
  });
  afterEach(() => jest.useRealTimers());

  it("applies the remaining filters to the current period's spend", async () => {
    const { repository } = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const dining = await repository.saveCategory({
      name: "Coffee shops",
      kind: "expense",
      icon: repository.getSnapshot().categories[0].icon,
      color: "#123456",
      parentId: null,
      archived: false,
    });
    const budget = await repository.saveBudget(
      monthly({
        filters: {
          accountIds: [account.id],
          categoryIds: [dining.id],
          tagIds: [],
        },
      }),
    );
    await repository.saveTransaction({
      kind: "expense",
      title: "Lunch",
      localDate: "2026-06-10",
      accountId: account.id,
      categoryId: dining.id,
      amountMinor: 300,
    });
    await repository.saveTransaction({
      kind: "expense",
      title: "Misc",
      localDate: "2026-06-11",
      accountId: account.id,
      amountMinor: 200,
    });
    const status = () =>
      repository
        .getBudgetStatuses("2026-06-15")
        .find((entry) => entry.budget.id === budget.id)!;
    expect(status().spentMinor).toBe(300);

    await repository.deleteEntities("categories", [dining.id]);
    expect(status().snapshot.filters.categoryIds).toEqual([]);
    expect(status().spentMinor).toBe(500);
  });
});

describe("budget rollover reset", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const mayBudget = (overrides: Partial<BudgetInput> = {}) =>
    monthly({
      limitMinor: 10000,
      rollover: true,
      period: {
        unit: "month",
        interval: 1,
        anchorDate: "2026-05-01",
        endDate: null,
      },
      ...overrides,
    });

  it("refuses a reset that would take the limit below zero", async () => {
    at("2026-05-15");
    const { repository } = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const budget = await repository.saveBudget(mayBudget());
    await repository.saveTransaction({
      kind: "expense",
      title: "Rent",
      localDate: "2026-05-10",
      accountId: account.id,
      amountMinor: 5000,
    });
    at("2026-06-15");
    await repository.generateRecurring();
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: -12000,
      note: "Cut",
    });
    // Limit 10000 + rollover 5000 - 12000 = 3000: still legal. Zeroing the rollover leaves -2000.
    await expect(repository.resetBudgetRollover(budget.id)).rejects.toThrow(
      "below zero",
    );
    const [status] = repository.getBudgetStatuses("2026-06-15");
    expect(status.snapshot.rolloverMinor).toBe(5000);
    expect(status.effectiveLimitMinor).toBe(3000);
  });

  it("persists the reset of a period that rolled over without a stored snapshot", async () => {
    at("2026-05-15");
    const { repository } = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const budget = await repository.saveBudget(mayBudget());
    await repository.saveTransaction({
      kind: "expense",
      title: "Rent",
      localDate: "2026-05-10",
      accountId: account.id,
      amountMinor: 5000,
    });
    at("2026-06-15");
    // No generateRecurring: June exists only as a transient snapshot.
    expect(
      repository.getBudgetStatuses("2026-06-15")[0].effectiveLimitMinor,
    ).toBe(15000);
    await repository.resetBudgetRollover(budget.id);
    const [status] = repository.getBudgetStatuses("2026-06-15");
    expect(status.snapshot.rolloverMinor).toBe(0);
    expect(status.effectiveLimitMinor).toBe(10000);
    expect(
      repository
        .getSnapshot()
        .budgetPeriods.some(
          (item) =>
            item.periodStart === "2026-06-01" && item.rolloverMinor === 0,
        ),
    ).toBe(true);
  });
});

describe("recurring generation writes", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-05-15");
  });
  afterEach(() => jest.useRealTimers());

  it("commits a newly opened budget period in the same write as the transactions", async () => {
    const { repository, storage } = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    await repository.saveBudget(
      monthly({
        period: {
          unit: "month",
          interval: 1,
          anchorDate: "2026-05-01",
          endDate: null,
        },
      }),
    );
    await repository.saveRecurringRule(
      rentRule(account.id, {
        startDate: "2026-06-01",
        nextDueDate: "2026-06-01",
      }),
    );
    at("2026-06-15");
    const spy = jest.spyOn(storage, "putMany");
    await repository.generateRecurring();
    expect(spy).toHaveBeenCalledTimes(1);
    const types = spy.mock.calls[0][0].map((record) => record.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "transactions",
        "recurringRules",
        "budgetPeriods",
      ]),
    );
    spy.mockRestore();
  });

  it("stores a derived rate as a plain decimal string when it is tiny", async () => {
    at("2026-06-15");
    const { repository } = await createRepository();
    await repository.saveExchangeRate({
      fromCurrency: "USD",
      toCurrency: "EUR",
      rate: "1000000000",
      effectiveDate: "2026-06-01",
    });
    const eur = await repository.saveAccount(
      accountInput({ name: "Euro", currency: "EUR" }),
    );
    const transaction = await repository.saveTransaction({
      kind: "expense",
      title: "Big",
      localDate: "2026-06-10",
      accountId: eur.id,
      amountMinor: 1_000_000_000_000_000,
    });
    expect(transaction.exchangeRate).toBe("0.000000001");
    expect(transaction.exchangeRate).not.toMatch(/e/i);
  });

  it("generates a rate-less upcoming occurrence while its exchange rate is missing", async () => {
    const { repository } = await createRepository();
    await repository.saveExchangeRate({
      fromCurrency: "EUR",
      toCurrency: "USD",
      rate: "1.1",
      effectiveDate: "2026-05-01",
    });
    const eur = await repository.saveAccount(
      accountInput({ name: "Euro", currency: "EUR" }),
    );
    const rule = await repository.saveRecurringRule(
      rentRule(eur.id, {
        template: {
          kind: "expense",
          title: "Rent",
          note: "",
          accountId: eur.id,
          categoryId: null,
          tagIds: [],
          amountMinor: 100,
          currency: "EUR",
        },
        startDate: "2026-05-20",
        nextDueDate: "2026-05-20",
      }),
    );
    // Removing the only EUR rate leaves the next occurrence unpriced. An upcoming occurrence
    // does not need a rate, so it is still generated and the rule keeps advancing.
    const manual = repository
      .getSnapshot()
      .exchangeRates.find(
        (item) => item.fromCurrency === "EUR" && item.toCurrency === "USD",
      )!;
    await repository.deleteEntities("exchangeRates", [manual.id]);

    await repository.generateRecurring("2026-06-30");
    const after = repository
      .getSnapshot()
      .recurringRules.find((item) => item.id === rule.id)!;
    expect(after).toMatchObject({ active: true, nextDueDate: "2026-07-20" });
    const generated = repository
      .getSnapshot()
      .transactions.filter((item) => item.recurringRuleId === rule.id);
    expect(generated.length).toBe(2);
    for (const transaction of generated) {
      expect(transaction).toMatchObject({
        status: "upcoming",
        exchangeRate: null,
        baseAmountMinor: null,
      });
    }
  });

  it("rethrows a programming error instead of pausing the rule", async () => {
    const { repository } = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const rule = await repository.saveRecurringRule(
      rentRule(account.id, {
        startDate: "2026-05-20",
        nextDueDate: "2026-05-20",
      }),
    );
    const internals = repository as unknown as {
      buildTransaction: (...args: unknown[]) => unknown;
    };
    const spy = jest
      .spyOn(internals, "buildTransaction")
      .mockImplementation(() => {
        throw new TypeError("boom");
      });
    await expect(repository.generateRecurring("2026-06-30")).rejects.toThrow(
      TypeError,
    );
    spy.mockRestore();
    expect(
      repository
        .getSnapshot()
        .recurringRules.find((item) => item.id === rule.id),
    ).toMatchObject({ active: true });
  });

  it("pauses a rule on a domain failure", async () => {
    const { repository } = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const rule = await repository.saveRecurringRule(
      rentRule(account.id, {
        startDate: "2026-05-20",
        nextDueDate: "2026-05-20",
      }),
    );
    const internals = repository as unknown as {
      buildTransaction: (...args: unknown[]) => unknown;
    };
    const spy = jest
      .spyOn(internals, "buildTransaction")
      .mockImplementation(() => {
        throw new Error("Choose a valid account.");
      });
    await repository.generateRecurring("2026-06-30");
    spy.mockRestore();
    expect(
      repository
        .getSnapshot()
        .recurringRules.find((item) => item.id === rule.id),
    ).toMatchObject({ active: false, pausedByDependency: false });
  });
});

describe("fetched rate batches", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("counts one row per pair and date, and the later row wins", async () => {
    at("2026-06-15");
    const { repository } = await createRepository();
    const result = await repository.saveFetchedRates([
      {
        fromCurrency: "EUR",
        toCurrency: "USD",
        effectiveDate: "2026-06-01",
        rate: "1.1",
      },
      {
        fromCurrency: "EUR",
        toCurrency: "USD",
        effectiveDate: "2026-06-01",
        rate: "1.2",
      },
    ]);
    expect(result.written).toBe(1);
    const stored = repository
      .getSnapshot()
      .exchangeRates.find(
        (item) => item.id === fetchedRateId("EUR", "USD", "2026-06-01"),
      );
    expect(stored?.rate).toBe("1.2");
  });
});

describe("archiving accounts", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("refuses to archive the last live account", async () => {
    at("2026-06-15");
    const { repository } = await createRepository();
    const only = repository.getSnapshot().accounts[0];
    await expect(
      repository.saveAccount(
        {
          name: only.name,
          type: only.type,
          currency: only.currency,
          openingBalanceMinor: only.openingBalanceMinor,
          icon: only.icon,
          color: only.color,
          archived: true,
        },
        only.id,
      ),
    ).rejects.toThrow("at least one account");
    expect(repository.getSnapshot().accounts[0].archived).toBe(false);
  });
});

describe("CSV tag matching", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("reuses an existing tag by name and keeps accented names distinct", async () => {
    at("2026-06-15");
    const { repository } = await createRepository();
    await repository.saveTag({ name: "Cafe", color: "#6D7885" });
    const row = (tags: string, rowNumber: number) => ({
      rowNumber,
      date: "2026-06-10",
      type: "expense" as const,
      title: "Coffee",
      amount: "4.50",
      currency: "USD",
      account: "Everyday",
      category: "",
      tags,
      note: "",
      exchangeRate: "",
      destinationAccount: "",
      destinationAmount: "",
    });
    await repository.importCsv([row("CAFE", 2), row("Café", 3)] as never, true);
    const names = repository
      .getSnapshot()
      .tags.map((tag) => tag.name)
      .sort();
    expect(names).toEqual(["Cafe", "Café"]);
  });
});
