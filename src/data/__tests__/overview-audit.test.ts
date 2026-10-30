import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { BudgetInput } from "@/data/repository";

const TODAY = "2026-07-15";

async function setup(openingBalanceMinor = 0) {
  const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
  await repository.initialize();
  await repository.completeOnboarding({
    locale: "en-US",
    baseCurrency: "USD",
    accountName: "Everyday",
    accountType: "checking",
    openingBalanceMinor,
    themeMode: "system",
    accentSource: "system",
    accentHex: "#5966E9",
  });
  return { repository, account: repository.getSnapshot().accounts[0] };
}

const budget = (overrides: Partial<BudgetInput> = {}): BudgetInput => ({
  name: "Everything",
  icon: "chart",
  color: "#5966E9",
  limitMinor: 100_000,
  period: {
    unit: "month",
    interval: 1,
    anchorDate: "2026-01-01",
    endDate: null,
  },
  rollover: false,
  filters: { accountIds: [], categoryIds: [], tagIds: [] },
  categoryLimits: [],
  archived: false,
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
});
afterEach(() => jest.useRealTimers());

describe("dashboard budget totals", () => {
  async function withFood() {
    const { repository, account } = await setup();
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
      localDate: "2026-07-10",
      accountId: account.id,
      categoryId: food.id,
      amountMinor: 4_000,
    });
    await repository.saveTransaction({
      kind: "expense",
      title: "Bus",
      localDate: "2026-07-11",
      accountId: account.id,
      amountMinor: 1_000,
    });
    return { repository, food };
  }

  it("counts a transaction once when two budgets match it", async () => {
    const { repository, food } = await withFood();
    await repository.saveBudget(budget());
    await repository.saveBudget(
      budget({
        name: "Food",
        limitMinor: 20_000,
        filters: { accountIds: [], categoryIds: [food.id], tagIds: [] },
      }),
    );
    const summary = repository.getDashboard("2026-07-01", "2026-07-31");
    // 5_000 is all the user spent; the 4_000 lunch sits in both budgets but is one lunch.
    expect(summary.budgetSpentMinor).toBe(5_000);
  });

  it("leaves a budget nested in an all-spending budget out of the limit", async () => {
    const { repository, food } = await withFood();
    await repository.saveBudget(budget());
    await repository.saveBudget(
      budget({
        name: "Food",
        limitMinor: 20_000,
        filters: { accountIds: [], categoryIds: [food.id], tagIds: [] },
      }),
    );
    const summary = repository.getDashboard("2026-07-01", "2026-07-31");
    expect(summary.budgetLimitMinor).toBe(100_000);
  });

  it("still sums budgets that merely overlap and adds each spend once", async () => {
    const { repository, food } = await withFood();
    await repository.saveBudget(
      budget({
        name: "Food",
        limitMinor: 20_000,
        filters: { accountIds: [], categoryIds: [food.id], tagIds: [] },
      }),
    );
    const snapshot = repository.getSnapshot();
    await repository.saveBudget(
      budget({
        name: "Main account",
        limitMinor: 30_000,
        filters: {
          accountIds: [snapshot.accounts[0].id],
          categoryIds: [],
          tagIds: [],
        },
      }),
    );
    const summary = repository.getDashboard("2026-07-01", "2026-07-31");
    expect(summary.budgetLimitMinor).toBe(50_000);
    expect(summary.budgetSpentMinor).toBe(5_000);
  });

  it("keeps one limit of two identical all-spending budgets", async () => {
    const { repository } = await withFood();
    await repository.saveBudget(budget({ name: "A" }));
    await repository.saveBudget(budget({ name: "B" }));
    const summary = repository.getDashboard("2026-07-01", "2026-07-31");
    expect(summary.budgetLimitMinor).toBe(100_000);
    expect(summary.budgetSpentMinor).toBe(5_000);
  });

  it("keeps a single budget's figures unchanged", async () => {
    const { repository } = await withFood();
    await repository.saveBudget(budget());
    const summary = repository.getDashboard("2026-07-01", "2026-07-31");
    expect(summary.budgetLimitMinor).toBe(100_000);
    expect(summary.budgetSpentMinor).toBe(5_000);
  });
});
