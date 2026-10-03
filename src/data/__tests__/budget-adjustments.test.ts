import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { BudgetInput } from "@/data/repository";

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

describe("one-time budget adjustments", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-15");
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("adds to the effective limit and exposes the breakdown", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "  Birthday money ",
    });

    const [status] = repository.getBudgetStatuses("2026-06-15");
    expect(status).toMatchObject({
      adjustmentMinor: 250,
      effectiveLimitMinor: 1250,
    });
    expect(status.snapshot.limitMinor).toBe(1000);
    expect(status.adjustments).toHaveLength(1);
    expect(status.adjustments[0]).toMatchObject({
      amountMinor: 250,
      note: "Birthday money",
      date: "2026-06-15",
    });
    expect(
      repository.getDashboard("2026-06-01", "2026-06-30").budgetLimitMinor,
    ).toBe(1250);
  });

  it("supports negative adjustments and sums several of them", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 500,
      note: "",
    });
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: -300,
      note: "Cutting back",
    });
    expect(repository.getBudgetStatuses("2026-06-15")[0]).toMatchObject({
      adjustmentMinor: 200,
      effectiveLimitMinor: 1200,
    });
  });

  it("rejects zero, unsafe, unknown-budget and archived-budget adjustments", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: 0,
        note: "",
      }),
    ).rejects.toThrow("non-zero");
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: 1.5,
        note: "",
      }),
    ).rejects.toThrow("non-zero");
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: Number.MAX_SAFE_INTEGER + 1,
        note: "",
      }),
    ).rejects.toThrow("non-zero");
    await expect(
      repository.addBudgetAdjustment({
        budgetId: "missing",
        amountMinor: 100,
        note: "",
      }),
    ).rejects.toThrow("valid budget");
    await repository.saveBudget(monthly({ archived: true }), budget.id);
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: 100,
        note: "",
      }),
    ).rejects.toThrow("valid budget");
    expect(repository.getSnapshot().budgetAdjustments).toHaveLength(0);
  });

  it("refuses a cut that would take the limit below zero, but allows one down to exactly zero", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: -1001,
        note: "",
      }),
    ).rejects.toThrow("below zero");
    expect(
      repository.getBudgetStatuses("2026-06-15")[0].effectiveLimitMinor,
    ).toBe(1000);
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: -1000,
      note: "",
    });
    expect(
      repository.getBudgetStatuses("2026-06-15")[0].effectiveLimitMinor,
    ).toBe(0);
  });

  it("refuses a whole-vault total that would overflow", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: Number.MAX_SAFE_INTEGER,
        note: "",
      }),
    ).rejects.toThrow();
    expect(repository.getSnapshot().budgetAdjustments).toHaveLength(0);
  });

  it("carries an unspent bonus into the next period when rollover is on", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage);
    const account = repository.getSnapshot().accounts[0];
    const budget = await repository.saveBudget(monthly({ rollover: true }));
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 500,
      note: "",
    });
    await repository.saveTransaction({
      kind: "expense",
      title: "June",
      localDate: "2026-06-20",
      accountId: account.id,
      amountMinor: 400,
    });

    at("2026-07-15");
    const reloaded = new LocalFinanceRepository(storage);
    await reloaded.initialize();
    // June had 1000 + 500 to spend and spent 400, so 1100 rolls into July's 1000.
    expect(reloaded.getBudgetStatuses("2026-07-15")[0]).toMatchObject({
      adjustmentMinor: 0,
      effectiveLimitMinor: 2100,
    });
  });

  it("lets the bonus expire with its period when rollover is off", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage);
    const budget = await repository.saveBudget(monthly({ rollover: false }));
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 500,
      note: "",
    });

    at("2026-07-15");
    const reloaded = new LocalFinanceRepository(storage);
    await reloaded.initialize();
    expect(
      reloaded.getBudgetStatuses("2026-07-15")[0].effectiveLimitMinor,
    ).toBe(1000);
    // Still there as history for the period it belonged to.
    expect(reloaded.getSnapshot().budgetAdjustments).toHaveLength(1);
  });

  it("carries a cut forward as a smaller remainder under rollover", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage);
    const budget = await repository.saveBudget(monthly({ rollover: true }));
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: -400,
      note: "",
    });

    at("2026-07-15");
    const reloaded = new LocalFinanceRepository(storage);
    await reloaded.initialize();
    expect(
      reloaded.getBudgetStatuses("2026-07-15")[0].effectiveLimitMinor,
    ).toBe(1600);
  });

  it("keeps the adjustment when the budget limit is edited", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "",
    });
    await repository.saveBudget(monthly({ limitMinor: 2000 }), budget.id);
    expect(repository.getBudgetStatuses("2026-06-15")[0]).toMatchObject({
      adjustmentMinor: 250,
      effectiveLimitMinor: 2250,
    });
  });

  it("re-homes the adjustment to whichever window now contains its date", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "",
    });
    // Weekly windows anchored on Monday 2026-06-01: 2026-06-15 falls in the week of the 15th.
    await repository.saveBudget(
      monthly({
        period: {
          unit: "week",
          interval: 1,
          anchorDate: "2026-06-01",
          endDate: null,
        },
      }),
      budget.id,
    );
    expect(repository.getBudgetStatuses("2026-06-15")[0].adjustmentMinor).toBe(
      250,
    );
    expect(repository.getBudgetStatuses("2026-06-22")[0].adjustmentMinor).toBe(
      0,
    );
  });

  it("soft-deletes an adjustment and stops counting it", async () => {
    const { repository, storage } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    const adjustment = await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "",
    });
    await repository.deleteBudgetAdjustment(adjustment.id);

    expect(repository.getBudgetStatuses("2026-06-15")[0]).toMatchObject({
      adjustmentMinor: 0,
      effectiveLimitMinor: 1000,
    });
    expect(repository.getSnapshot().budgetAdjustments).toHaveLength(0);
    const stored = await storage.readAll("budgetAdjustments");
    expect(stored).toHaveLength(1);
    expect(stored[0].deletedAt).not.toBeNull();
  });

  it("refuses to remove an adjustment that belongs to a closed period", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    const adjustment = await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "",
    });
    at("2026-07-15");
    await expect(
      repository.deleteBudgetAdjustment(adjustment.id),
    ).rejects.toThrow("current period");
    expect(repository.getSnapshot().budgetAdjustments).toHaveLength(1);
    await expect(repository.deleteBudgetAdjustment("missing")).rejects.toThrow(
      "valid budget adjustment",
    );
  });

  it("refuses to remove a bonus when that would take the limit below zero", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    const bonus = await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 500,
      note: "",
    });
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: -1400,
      note: "",
    });
    // 1000 + 500 - 1400 = 100. Dropping the +500 would leave -400.
    await expect(repository.deleteBudgetAdjustment(bonus.id)).rejects.toThrow(
      "below zero",
    );
    expect(
      repository.getBudgetStatuses("2026-06-15")[0].effectiveLimitMinor,
    ).toBe(100);
  });

  it("retires a budget’s adjustments when the budget is deleted", async () => {
    const { repository, storage } = await createRepository();
    const budget = await repository.saveBudget(monthly());
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "",
    });
    await repository.deleteEntities("budgets", [budget.id]);
    expect(repository.getSnapshot().budgetAdjustments).toHaveLength(0);
    expect(
      (await storage.readAll("budgetAdjustments"))[0].deletedAt,
    ).not.toBeNull();
  });

  it("persists across a reload", async () => {
    const storage = new MemoryStorageAdapter();
    const { repository } = await createRepository(storage);
    const budget = await repository.saveBudget(monthly());
    await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "Gift",
    });
    const reloaded = new LocalFinanceRepository(storage);
    await reloaded.initialize();
    expect(reloaded.getBudgetStatuses("2026-06-15")[0]).toMatchObject({
      adjustmentMinor: 250,
      effectiveLimitMinor: 1250,
    });
  });

  it("leaves state untouched when the write fails", async () => {
    class FailingStorage extends MemoryStorageAdapter {
      fail = false;

      override async putMany(
        records: Parameters<MemoryStorageAdapter["putMany"]>[0],
        source?: object,
      ) {
        if (this.fail) throw new Error("simulated disk failure");
        await super.putMany(records, source);
      }
    }
    const storage = new FailingStorage();
    const { repository } = await createRepository(storage);
    const budget = await repository.saveBudget(monthly());
    const adjustment = await repository.addBudgetAdjustment({
      budgetId: budget.id,
      amountMinor: 250,
      note: "",
    });
    storage.fail = true;
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: 100,
        note: "",
      }),
    ).rejects.toThrow("simulated disk failure");
    await expect(
      repository.deleteBudgetAdjustment(adjustment.id),
    ).rejects.toThrow("simulated disk failure");
    expect(repository.getSnapshot().budgetAdjustments).toHaveLength(1);
    expect(
      repository.getBudgetStatuses("2026-06-15")[0].effectiveLimitMinor,
    ).toBe(1250);
  });

  it("will not adjust an expired custom budget", async () => {
    const { repository } = await createRepository();
    const budget = await repository.saveBudget(
      monthly({
        period: {
          unit: "custom",
          interval: 1,
          anchorDate: "2026-05-01",
          endDate: "2026-05-31",
        },
      }),
    );
    await expect(
      repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: 100,
        note: "",
      }),
    ).rejects.toThrow("no active period");
  });
});
