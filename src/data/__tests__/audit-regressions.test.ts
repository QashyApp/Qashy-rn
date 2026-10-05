import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { BudgetInput } from "@/data/repository";
import {
  budgetsArchivedByCategoryDeletion,
  categoryDeletionMessage,
} from "@/utils/category-impact";
import { decodeBundle } from "@/sync/transport/file";
import { validateExchangeRate } from "@/utils/form-validation";
import { budgetPace } from "@/utils/pace";

async function createRepository() {
  const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
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
  return repository;
}

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

const at = (iso: string) => jest.setSystemTime(new Date(`${iso}T09:00:00Z`));

describe("exchange rate validation", () => {
  it("rejects a zero, negative or absurd manual rate", () => {
    expect(validateExchangeRate("0")).toBeDefined();
    expect(validateExchangeRate("0.000")).toBeDefined();
    expect(validateExchangeRate("-1")).toBeDefined();
    expect(validateExchangeRate("0.0000000001")).toBeDefined();
    expect(validateExchangeRate("12345678901234567890")).toBeDefined();
    expect(validateExchangeRate("1.123456789012345")).toBeDefined();
    expect(validateExchangeRate("")).toBeDefined();
  });

  it("accepts ordinary and very small real-world rates", () => {
    expect(validateExchangeRate("1.0825")).toBeUndefined();
    expect(validateExchangeRate("0.0000000089")).toBeUndefined();
  });

  it("refuses to store a zero rate in the repository", async () => {
    const repository = await createRepository();
    await expect(
      repository.saveExchangeRate({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "0",
        effectiveDate: "2026-06-01",
      }),
    ).rejects.toThrow("positive");
    await expect(
      repository.saveExchangeRate({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "0.0",
        effectiveDate: "2026-06-01",
      }),
    ).rejects.toThrow("positive");
    expect(repository.getSnapshot().exchangeRates).toHaveLength(0);
  });
});

describe("cross-currency transfers without a stored rate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-15");
  });
  afterEach(() => jest.useRealTimers());

  it("prices a foreign → base transfer from the typed destination amount", async () => {
    const repository = await createRepository();
    const usd = repository.getSnapshot().accounts[0];
    const eur = await repository.saveAccount({
      name: "Euro",
      type: "checking",
      currency: "EUR",
      openingBalanceMinor: 100_00,
      icon: "wallet",
      color: "#5966E9",
      archived: false,
    });
    const transfer = await repository.saveTransaction({
      kind: "transfer",
      title: "Move",
      localDate: "2026-06-15",
      accountId: eur.id,
      destinationAccountId: usd.id,
      amountMinor: 100_00,
      destinationAmountMinor: 108_00,
    });
    expect(transfer.destinationAmountMinor).toBe(108_00);
    expect(transfer.baseAmountMinor).toBe(108_00);
    expect(transfer.destinationBaseAmountMinor).toBe(108_00);
    expect(Number(transfer.exchangeRate)).toBeCloseTo(1.08, 6);
  });

  it("prices a base → foreign transfer from the typed destination amount", async () => {
    const repository = await createRepository();
    const usd = repository.getSnapshot().accounts[0];
    const eur = await repository.saveAccount({
      name: "Euro",
      type: "checking",
      currency: "EUR",
      openingBalanceMinor: 0,
      icon: "wallet",
      color: "#5966E9",
      archived: false,
    });
    const transfer = await repository.saveTransaction({
      kind: "transfer",
      title: "Move",
      localDate: "2026-06-15",
      accountId: usd.id,
      destinationAccountId: eur.id,
      amountMinor: 108_00,
      destinationAmountMinor: 100_00,
    });
    expect(transfer.baseAmountMinor).toBe(108_00);
    expect(transfer.destinationBaseAmountMinor).toBe(108_00);
  });

  it("still reports the missing rate when no destination amount is typed", async () => {
    const repository = await createRepository();
    const usd = repository.getSnapshot().accounts[0];
    const eur = await repository.saveAccount({
      name: "Euro",
      type: "checking",
      currency: "EUR",
      openingBalanceMinor: 100_00,
      icon: "wallet",
      color: "#5966E9",
      archived: false,
    });
    await expect(
      repository.saveTransaction({
        kind: "transfer",
        title: "Move",
        localDate: "2026-06-15",
        accountId: eur.id,
        destinationAccountId: usd.id,
        amountMinor: 100_00,
      }),
    ).rejects.toThrow("Missing exchange rate");
  });
});

describe("amounts that round to nothing", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-15");
  });
  afterEach(() => jest.useRealTimers());

  it("rejects a foreign-currency expense that converts to zero", async () => {
    const repository = await createRepository();
    const usd = repository.getSnapshot().accounts[0];
    const eur = await repository.saveAccount({
      name: "Euro",
      type: "checking",
      currency: "EUR",
      openingBalanceMinor: 0,
      icon: "wallet",
      color: "#5966E9",
      archived: false,
    });
    await repository.saveExchangeRate({
      fromCurrency: "EUR",
      toCurrency: "USD",
      rate: "0.001",
      effectiveDate: "2026-06-01",
    });
    await expect(
      repository.saveTransaction({
        kind: "expense",
        title: "Free?",
        localDate: "2026-06-15",
        accountId: eur.id,
        amountMinor: 100,
      }),
    ).rejects.toThrow("smallest unit");
    expect(usd.currency).toBe("USD");
    expect(repository.getSnapshot().transactions).toHaveLength(0);
  });
});

describe("editing a recurring schedule", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-07-15");
  });
  afterEach(() => jest.useRealTimers());

  it("keeps overdue pending occurrences when only the end date changes", async () => {
    const repository = await createRepository();
    // A new rule starts at its first occurrence on or after today, so create it on its start date.
    at("2026-07-01");
    const account = repository.getSnapshot().accounts[0];
    const rule = await repository.saveRecurringRule({
      template: {
        kind: "expense",
        title: "Rent",
        note: "",
        accountId: account.id,
        categoryId: null,
        tagIds: [],
        amountMinor: 100,
        currency: "USD",
      },
      unit: "month",
      interval: 1,
      startDate: "2026-07-01",
      endDate: null,
      nextDueDate: "2026-07-01",
      autoPost: false,
      active: true,
    });
    const before = repository
      .getSnapshot()
      .transactions.filter((item) => item.status === "upcoming")
      .map((item) => item.localDate)
      .sort();
    expect(before).toContain("2026-07-01");

    // Time passes: the July occurrence is now overdue.
    at("2026-09-03");
    await repository.saveRecurringRule(
      { ...rule, endDate: "2027-01-01" },
      rule.id,
    );

    const after = repository
      .getSnapshot()
      .transactions.filter((item) => item.status === "upcoming")
      .map((item) => item.localDate);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(new Set(after).size).toBe(after.length);
  });

  it("backfills missed occurrences when the start date moves earlier", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const rule = await repository.saveRecurringRule({
      template: {
        kind: "expense",
        title: "Gym",
        note: "",
        accountId: account.id,
        categoryId: null,
        tagIds: [],
        amountMinor: 100,
        currency: "USD",
      },
      unit: "month",
      interval: 1,
      startDate: "2026-07-01",
      endDate: null,
      nextDueDate: "2026-07-01",
      autoPost: false,
      active: true,
    });
    await repository.saveRecurringRule(
      { ...rule, startDate: "2026-04-01" },
      rule.id,
    );
    await repository.generateRecurring();
    const dates = repository
      .getSnapshot()
      .transactions.filter(
        (item) => item.recurringRuleId === rule.id && !item.deletedAt,
      )
      .map((item) => item.localDate);
    expect(dates).toEqual(
      expect.arrayContaining([
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
      ]),
    );
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe("deleting accounts", () => {
  it("removes a deleted account from net worth and refuses to delete the last one", async () => {
    const repository = await createRepository();
    const first = repository.getSnapshot().accounts[0];
    const second = await repository.saveAccount({
      name: "Second",
      type: "checking",
      currency: first.currency,
      openingBalanceMinor: 5000,
      icon: "wallet.bifold",
      color: "#123456",
      archived: false,
    });
    await repository.saveTransaction({
      kind: "income",
      title: "Pay",
      localDate: "2026-06-10",
      accountId: second.id,
      amountMinor: 100,
    });
    const worth = () =>
      repository
        .getDashboard("2026-06-01", "2026-06-30")
        .accountBalances.map((item) => item.account.id);
    expect(worth()).toContain(second.id);
    await repository.deleteEntities("accounts", [second.id]);
    expect(worth()).not.toContain(second.id);
    await expect(
      repository.deleteEntities("accounts", [first.id]),
    ).rejects.toThrow("at least one account");
  });
});

describe("budget rollover", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-15");
  });
  afterEach(() => jest.useRealTimers());

  async function budgetWithCarry() {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const budget = await repository.saveBudget(monthly({ rollover: true }));
    await repository.saveTransaction({
      kind: "expense",
      title: "Groceries",
      localDate: "2026-06-10",
      accountId: account.id,
      amountMinor: 300,
    });
    at("2026-07-15");
    await repository.generateRecurring();
    return { repository, budget };
  }

  it("restores the carried amount when rollover is switched off and on again", async () => {
    const { repository, budget } = await budgetWithCarry();
    expect(
      repository.getBudgetStatuses("2026-07-15")[0].effectiveLimitMinor,
    ).toBe(1700);

    const off = await repository.saveBudget(
      monthly({ rollover: false }),
      budget.id,
    );
    expect(
      repository.getBudgetStatuses("2026-07-15")[0].effectiveLimitMinor,
    ).toBe(1000);

    await repository.saveBudget(monthly({ rollover: true }), off.id);
    expect(
      repository.getBudgetStatuses("2026-07-15")[0].effectiveLimitMinor,
    ).toBe(1700);
  });

  it("can explicitly reset the carried amount", async () => {
    const { repository, budget } = await budgetWithCarry();
    await repository.resetBudgetRollover(budget.id);
    const [status] = repository.getBudgetStatuses("2026-07-15");
    expect(status.snapshot.rolloverMinor).toBe(0);
    expect(status.effectiveLimitMinor).toBe(1000);
  });
});

describe("search", () => {
  it("ignores case and accents", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    await repository.saveTransaction({
      kind: "expense",
      title: "Café Noir",
      localDate: "2026-06-10",
      accountId: account.id,
      amountMinor: 450,
    });
    expect(repository.queryTransactions({ search: "cafe" })).toHaveLength(1);
    expect(repository.queryTransactions({ search: "CAFÉ" })).toHaveLength(1);
    expect(repository.queryTransactions({ search: "tea" })).toHaveLength(0);
  });
});

describe("category deletion impact", () => {
  it("names the budgets that would be archived", async () => {
    const repository = await createRepository();
    const category = await repository.saveCategory({
      name: "Pet care",
      kind: "expense",
      color: "#36A852",
      icon: "cart",
      parentId: null,
      archived: false,
    });
    const budget = await repository.saveBudget(
      monthly({
        name: "Food",
        filters: { accountIds: [], categoryIds: [category.id], tagIds: [] },
      }),
    );
    const budgets = repository.getSnapshot().budgets;
    expect(
      budgetsArchivedByCategoryDeletion(budgets, [category.id]).map(
        (item) => item.id,
      ),
    ).toEqual([budget.id]);
    expect(categoryDeletionMessage(budgets, [category.id])).toContain("“Food”");

    await repository.deleteEntities("categories", [category.id]);
    expect(
      repository.getSnapshot().budgets.find((item) => item.id === budget.id)
        ?.archived,
    ).toBe(true);
  });

  it("does not warn for a budget that keeps another category", async () => {
    const repository = await createRepository();
    const a = await repository.saveCategory({
      name: "Alpha test",
      kind: "expense",
      color: "#36A852",
      icon: "cart",
      parentId: null,
      archived: false,
    });
    const b = await repository.saveCategory({
      name: "Beta test",
      kind: "expense",
      color: "#36A852",
      icon: "cart",
      parentId: null,
      archived: false,
    });
    await repository.saveBudget(
      monthly({
        filters: { accountIds: [], categoryIds: [a.id, b.id], tagIds: [] },
      }),
    );
    expect(
      budgetsArchivedByCategoryDeletion(repository.getSnapshot().budgets, [
        a.id,
      ]),
    ).toHaveLength(0);
  });
});

describe("budget projection", () => {
  it("is not reliable after only a few days of a month", () => {
    const early = budgetPace({
      spentMinor: 300,
      limitMinor: 1000,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      today: "2026-10-03",
    });
    expect(early.projectionReliable).toBe(false);
    expect(early.status).not.toBe("projectedOver");
    const later = budgetPace({
      spentMinor: 300,
      limitMinor: 1000,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      today: "2026-10-09",
    });
    expect(later.projectionReliable).toBe(true);
  });

  it("is reliable for a one-day budget", () => {
    const daily = budgetPace({
      spentMinor: 10,
      limitMinor: 100,
      periodStart: "2026-10-03",
      periodEnd: "2026-10-03",
      today: "2026-10-03",
    });
    expect(daily.projectionReliable).toBe(true);
  });
});

describe("importing something that is not a sync file", () => {
  it("says so instead of blaming a newer version", () => {
    expect(() => decodeBundle("{}")).toThrow("not a Qashy sync file");
    expect(() => decodeBundle('{"hello":"world"}')).toThrow(
      "not a Qashy sync file",
    );
    expect(() => decodeBundle('{"version":99,"from":"x","frames":[]}')).toThrow(
      "newer version",
    );
  });
});
