import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { BudgetInput } from "@/data/repository";
import { ACCOUNT_TYPE_ICON } from "@/domain/defaults";
import type { AccountType } from "@/domain/models";

const at = (iso: string) => jest.setSystemTime(new Date(`${iso}T09:00:00Z`));

async function createRepository(accountType: AccountType = "checking") {
  const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
  await repository.initialize();
  await repository.completeOnboarding({
    locale: "en-US",
    baseCurrency: "USD",
    accountName: "Everyday",
    accountType,
    openingBalanceMinor: 100_000,
    themeMode: "system",
    accentSource: "system",
    accentHex: "#5966E9",
  });
  return repository;
}

const monthlyBudget = (overrides: Partial<BudgetInput> = {}): BudgetInput => ({
  name: "Monthly",
  icon: "chart",
  color: "#5966E9",
  limitMinor: 50_000,
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

describe("the first account's icon", () => {
  it.each(Object.keys(ACCOUNT_TYPE_ICON) as AccountType[])(
    "is the %s type's icon, not a generic wallet",
    async (type) => {
      const repository = await createRepository(type);
      expect(repository.getSnapshot().accounts[0]).toMatchObject({
        type,
        icon: ACCOUNT_TYPE_ICON[type],
      });
    },
  );
});

describe("budget totals with the auto-posts that are due", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-01");
  });
  afterEach(() => jest.useRealTimers());

  async function withWeeklyGym() {
    const repository = await createRepository();
    await repository.saveBudget(monthlyBudget());
    const account = repository.getSnapshot().accounts[0];
    await repository.saveRecurringRule({
      template: {
        kind: "expense",
        title: "Gym",
        note: "",
        accountId: account.id,
        categoryId: null,
        tagIds: [],
        amountMinor: 2_500,
        currency: "USD",
      },
      unit: "week",
      interval: 1,
      startDate: "2026-06-03",
      endDate: null,
      nextDueDate: "2026-06-03",
      autoPost: true,
      active: true,
    });
    at("2026-06-18");
    return repository;
  }

  it("matches the dashboard's own budget figures when nothing is pending", async () => {
    const repository = await createRepository();
    await repository.saveBudget(monthlyBudget());
    const summary = repository.getDashboard("2026-06-01", "2026-06-30");
    expect(repository.getBudgetTotals("2026-06-01", "2026-06-30")).toEqual({
      budgetLimitMinor: summary.budgetLimitMinor,
      budgetSpentMinor: summary.budgetSpentMinor,
    });
  });

  it("counts what generation would post, and never what is not due yet", async () => {
    const repository = await withWeeklyGym();
    expect(
      repository.getBudgetTotals("2026-06-01", "2026-06-30").budgetSpentMinor,
    ).toBe(0);

    // The range runs to the month's end, but only June 3, 10 and 17 are due by June 18.
    const pending = repository.getBudgetTotals("2026-06-01", "2026-06-30", {
      includePendingAutoPosts: true,
    });
    expect(pending.budgetSpentMinor).toBe(7_500);

    await repository.generateRecurring("2026-06-18");
    expect(repository.getBudgetTotals("2026-06-01", "2026-06-30")).toEqual(
      pending,
    );
  });

  it("changes nothing", async () => {
    const repository = await withWeeklyGym();
    const state = repository.getSnapshot();
    const listener = jest.fn();
    repository.subscribe(listener);
    repository.getBudgetTotals("2026-06-01", "2026-06-30", {
      includePendingAutoPosts: true,
    });
    expect(listener).not.toHaveBeenCalled();
    expect(repository.getSnapshot()).toBe(state);
    expect(
      repository.getBudgetTotals("2026-06-01", "2026-06-30").budgetSpentMinor,
    ).toBe(0);
  });

  it("caps the dashboard's own pending preview at today too", async () => {
    const repository = await withWeeklyGym();
    const preview = repository.getDashboard("2026-06-01", "2026-06-30", {
      includePendingAutoPosts: true,
    });
    expect(preview.expenseMinor).toBe(7_500);
  });
});

describe("budget totals across many budgets", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-18");
  });
  afterEach(() => jest.useRealTimers());

  it("counts a transaction once however many budgets match it", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const food = await repository.saveCategory({
      name: "Food",
      kind: "expense",
      icon: "cart",
      color: "#5966E9",
      parentId: null,
      archived: false,
    });
    await repository.saveTransaction({
      kind: "expense",
      title: "Lunch",
      localDate: "2026-06-10",
      accountId: account.id,
      categoryId: food.id,
      amountMinor: 1_200,
    });
    await repository.saveTransaction({
      kind: "expense",
      title: "Taxi",
      localDate: "2026-06-11",
      accountId: account.id,
      categoryId: null,
      amountMinor: 800,
    });
    await repository.saveBudget(monthlyBudget({ name: "Everything" }));
    await repository.saveBudget(
      monthlyBudget({
        name: "Food",
        limitMinor: 20_000,
        filters: { accountIds: [], categoryIds: [food.id], tagIds: [] },
      }),
    );
    await repository.saveBudget(
      monthlyBudget({
        name: "Everyday only",
        limitMinor: 10_000,
        filters: { accountIds: [account.id], categoryIds: [], tagIds: [] },
      }),
    );
    const totals = repository.getBudgetTotals("2026-06-01", "2026-06-30");
    // Lunch and Taxi are each one expense, however many of the three budgets count them.
    expect(totals.budgetSpentMinor).toBe(2_000);
    // "Everything" covers the same month and all spending, so it swallows the other two limits.
    expect(totals.budgetLimitMinor).toBe(50_000);
  });
});

describe("search through a category's parents", () => {
  it("finds every row of a category, however many share it, for each search", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const parent = await repository.saveCategory({
      name: "Pantry",
      kind: "expense",
      icon: "cart",
      color: "#5966E9",
      parentId: null,
      archived: false,
    });
    const child = await repository.saveCategory({
      name: "Snacks",
      kind: "expense",
      icon: "cart",
      color: "#5966E9",
      parentId: parent.id,
      archived: false,
    });
    const other = await repository.saveCategory({
      name: "Fuel",
      kind: "expense",
      icon: "cart",
      color: "#5966E9",
      parentId: null,
      archived: false,
    });
    const snacks: string[] = [];
    const fuel: string[] = [];
    for (let day = 1; day <= 6; day += 1) {
      const row = await repository.saveTransaction({
        kind: "expense",
        title: `Row ${day}`,
        localDate: `2026-06-0${day}`,
        accountId: account.id,
        categoryId: day % 2 ? child.id : other.id,
        amountMinor: 100,
      });
      (day % 2 ? snacks : fuel).push(row.id);
    }
    const found = (search: string) =>
      repository
        .queryTransactions({ search })
        .map((row) => row.id)
        .sort();
    expect(found("pantry")).toEqual([...snacks].sort());
    expect(found("snacks")).toEqual([...snacks].sort());
    expect(found("fuel")).toEqual([...fuel].sort());
    expect(found("pantry")).toEqual([...snacks].sort());
  });
});
