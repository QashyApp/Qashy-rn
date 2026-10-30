import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { BudgetInput, GoalInput, RecurringInput } from "@/data/repository";
import { overduePostedBySave } from "@/utils/recurring-impact";

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

const at = (iso: string) => jest.setSystemTime(new Date(`${iso}T09:00:00Z`));

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
    amountMinor: 5_000,
    currency: "USD",
  },
  unit: "month",
  interval: 1,
  startDate: "2026-06-15",
  endDate: null,
  nextDueDate: "2026-06-15",
  autoPost: false,
  active: true,
  ...overrides,
});

const goalInput = (overrides: Partial<GoalInput> = {}): GoalInput => ({
  name: "Trip",
  kind: "saving",
  icon: "target",
  color: "#5966E9",
  targetMinor: 10_000,
  initialMinor: 0,
  targetDate: null,
  linkedAccountId: null,
  linkedCategoryId: null,
  archived: false,
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers();
  at("2026-06-15");
});
afterEach(() => jest.useRealTimers());

describe("saving a foreign-currency schedule without an exchange rate", () => {
  const foreignRule = (accountId: string, overrides = {}) =>
    rule(accountId, {
      template: {
        kind: "expense",
        title: "Streaming",
        note: "",
        accountId,
        categoryId: null,
        tagIds: [],
        amountMinor: 5_000,
        currency: "USD",
        foreign: { amountMinor: 5_000, currency: "EUR" },
      },
      ...overrides,
    });

  it("saves a rule that starts later, keeping no rate on the template", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const saved = await repository.saveRecurringRule(
      foreignRule(account.id, {
        startDate: "2026-07-01",
        nextDueDate: "2026-07-01",
      }),
    );
    expect(saved.template.foreign).toEqual({
      amountMinor: 5_000,
      currency: "EUR",
    });
    expect(saved.template.amountMinor).toBeGreaterThan(0);
    expect(repository.getSnapshot().transactions).toHaveLength(0);
  });

  it("saves a rule that is already due and posts nothing until a rate exists", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const saved = await repository.saveRecurringRule(
      foreignRule(account.id, { autoPost: true }),
    );
    // Generation skips the rule while its rate is missing: nothing is posted, nothing is paused.
    expect(
      repository
        .getSnapshot()
        .transactions.filter((item) => item.recurringRuleId === saved.id),
    ).toHaveLength(0);
    const stored = repository
      .getSnapshot()
      .recurringRules.find((item) => item.id === saved.id)!;
    expect(stored).toMatchObject({ active: true, nextDueDate: "2026-06-15" });

    await repository.saveExchangeRate({
      fromCurrency: "EUR",
      toCurrency: "USD",
      rate: "1.1",
      effectiveDate: "2026-06-01",
    });
    await repository.generateRecurring();
    const generated = repository
      .getSnapshot()
      .transactions.filter((item) => item.recurringRuleId === saved.id);
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({
      status: "posted",
      amountMinor: 5_500,
      localDate: "2026-06-15",
    });
  });

  it("still honors a rate typed on the rule", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const saved = await repository.saveRecurringRule(
      foreignRule(account.id, {
        template: {
          kind: "expense",
          title: "Streaming",
          note: "",
          accountId: account.id,
          categoryId: null,
          tagIds: [],
          amountMinor: 1,
          currency: "USD",
          foreign: { amountMinor: 5_000, currency: "EUR", exchangeRate: "1.2" },
        },
      }),
    );
    expect(saved.template.foreign?.exchangeRate).toBe("1.2");
    expect(saved.template.amountMinor).toBe(6_000);
  });

  it("saves an edit that turns a priced schedule foreign, and regenerates once a rate exists", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const created = await repository.saveRecurringRule(rule(account.id));
    const pending = () =>
      repository
        .getSnapshot()
        .transactions.filter((item) => item.recurringRuleId === created.id);
    expect(pending()).toHaveLength(1);

    // Generation advanced the rule after it was created, so edit from its current revision.
    const current = repository
      .getSnapshot()
      .recurringRules.find((item) => item.id === created.id)!;
    const edited = await repository.saveRecurringRule(
      foreignRule(account.id),
      created.id,
      current.revision,
    );
    // The pending occurrence could not be priced, so it is discarded and the rule is wound back.
    expect(pending()).toHaveLength(0);
    expect(edited.nextDueDate).toBe("2026-06-15");

    await repository.saveExchangeRate({
      fromCurrency: "EUR",
      toCurrency: "USD",
      rate: "1.1",
      effectiveDate: "2026-06-01",
    });
    await repository.generateRecurring();
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({
      status: "upcoming",
      amountMinor: 5_500,
    });
  });
});

describe("turning on auto-post", () => {
  it("counts exactly the overdue items that saving posts", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    at("2026-06-01");
    const created = await repository.saveRecurringRule(
      rule(account.id, {
        unit: "week",
        startDate: "2026-06-01",
        nextDueDate: "2026-06-01",
      }),
    );
    at("2026-06-20");
    await repository.generateRecurring();
    const snapshot = repository.getSnapshot();
    const existing = snapshot.recurringRules.find(
      (item) => item.id === created.id,
    )!;
    const counted = overduePostedBySave(
      existing,
      { autoPost: true, active: true },
      snapshot.transactions,
      "2026-06-20",
    );
    expect(counted).toBe(3);

    await repository.saveRecurringRule(
      { ...existing, autoPost: true },
      existing.id,
      existing.revision,
    );
    const posted = repository
      .getSnapshot()
      .transactions.filter(
        (item) =>
          item.recurringRuleId === created.id && item.status === "posted",
      );
    expect(posted).toHaveLength(counted);
  });
});

describe("turning rollover on partway through a period", () => {
  async function monthWithSpend() {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const budget = await repository.saveBudget(monthly({ rollover: false }));
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

  it("brings the previous period's carry into the current one", async () => {
    const { repository, budget } = await monthWithSpend();
    const [before] = repository.getBudgetStatuses("2026-07-15");
    expect(before.snapshot.rolloverMinor).toBe(0);
    expect(before.effectiveLimitMinor).toBe(1000);

    await repository.saveBudget(monthly({ rollover: true }), budget.id);
    const [after] = repository.getBudgetStatuses("2026-07-15");
    expect(after.snapshot.rolloverMinor).toBe(700);
    expect(after.effectiveLimitMinor).toBe(1700);

    // History is not rewritten.
    const june = repository
      .getSnapshot()
      .budgetPeriods.find((item) => item.periodStart === "2026-06-01")!;
    expect(june.rolloverMinor).toBe(0);
  });

  it("carries a deficit too, capped at one period's limit", async () => {
    const repository = await createRepository();
    const account = repository.getSnapshot().accounts[0];
    const budget = await repository.saveBudget(monthly({ rollover: false }));
    await repository.saveTransaction({
      kind: "expense",
      title: "Big",
      localDate: "2026-06-10",
      accountId: account.id,
      amountMinor: 5000,
    });
    at("2026-07-15");
    await repository.generateRecurring();
    await repository.saveBudget(monthly({ rollover: true }), budget.id);
    const [status] = repository.getBudgetStatuses("2026-07-15");
    expect(status.snapshot.rolloverMinor).toBe(-1000);
    expect(status.effectiveLimitMinor).toBe(0);
  });

  it("leaves a carry that is already there alone when other fields change", async () => {
    const { repository, budget } = await monthWithSpend();
    const on = await repository.saveBudget(
      monthly({ rollover: true }),
      budget.id,
    );
    await repository.saveTransaction({
      kind: "expense",
      title: "Late June",
      localDate: "2026-06-20",
      accountId: repository.getSnapshot().accounts[0].id,
      amountMinor: 200,
    });
    // Rollover was already on: renaming must not recompute (and so change) the stored carry.
    await repository.saveBudget(
      monthly({ rollover: true, name: "Renamed" }),
      on.id,
    );
    const [status] = repository.getBudgetStatuses("2026-07-15");
    expect(status.snapshot.rolloverMinor).toBe(700);
  });

  it("starts a brand-new rollover budget from zero", async () => {
    const repository = await createRepository();
    await repository.saveBudget(monthly({ rollover: true }));
    const [status] = repository.getBudgetStatuses("2026-06-15");
    expect(status.snapshot.rolloverMinor).toBe(0);
  });
});

describe("saving a goal with a typed contribution", () => {
  it("edits an existing contribution together with the goal, in one write", async () => {
    const repository = await createRepository();
    const goal = await repository.saveGoal(goalInput());
    const contribution = await repository.saveContribution({
      goalId: goal.id,
      amountMinor: 1_000,
      localDate: "2026-06-10",
      transactionId: null,
      note: "First",
    });

    await repository.saveGoalAndContribution(
      goalInput({ name: "Trip 2" }),
      {
        amountMinor: 2_500,
        localDate: "2026-06-11",
        transactionId: null,
        note: "Edited",
      },
      goal.id,
      goal.revision,
      { id: contribution.id, expectedRevision: contribution.revision },
    );
    const snapshot = repository.getSnapshot();
    expect(snapshot.goals.find((item) => item.id === goal.id)?.name).toBe(
      "Trip 2",
    );
    expect(snapshot.contributions).toHaveLength(1);
    expect(snapshot.contributions[0]).toMatchObject({
      id: contribution.id,
      amountMinor: 2_500,
      localDate: "2026-06-11",
      note: "Edited",
    });
  });

  it("adds a new contribution with the goal when none is being edited", async () => {
    const repository = await createRepository();
    const goal = await repository.saveGoal(goalInput());
    await repository.saveGoalAndContribution(
      goalInput({ name: "Trip 2" }),
      {
        amountMinor: 700,
        localDate: "2026-06-12",
        transactionId: null,
        note: " Manual ",
      },
      goal.id,
      goal.revision,
    );
    expect(repository.getSnapshot().contributions).toMatchObject([
      { goalId: goal.id, amountMinor: 700, note: "Manual" },
    ]);
  });

  it("writes nothing when the contribution being edited changed elsewhere", async () => {
    const repository = await createRepository();
    const goal = await repository.saveGoal(goalInput());
    const contribution = await repository.saveContribution({
      goalId: goal.id,
      amountMinor: 1_000,
      localDate: "2026-06-10",
      transactionId: null,
      note: "First",
    });
    await expect(
      repository.saveGoalAndContribution(
        goalInput({ name: "Should not save" }),
        {
          amountMinor: 2_500,
          localDate: "2026-06-11",
          transactionId: null,
          note: "",
        },
        goal.id,
        goal.revision,
        { id: contribution.id, expectedRevision: contribution.revision + 1 },
      ),
    ).rejects.toThrow("changed in another window");
    const snapshot = repository.getSnapshot();
    expect(snapshot.goals.find((item) => item.id === goal.id)?.name).toBe(
      "Trip",
    );
    expect(snapshot.contributions[0].amountMinor).toBe(1_000);
  });

  it("rejects an invalid contribution without saving the goal", async () => {
    const repository = await createRepository();
    const goal = await repository.saveGoal(goalInput());
    await expect(
      repository.saveGoalAndContribution(
        goalInput({ name: "Should not save" }),
        {
          amountMinor: 0,
          localDate: "2026-06-11",
          transactionId: null,
          note: "",
        },
        goal.id,
        goal.revision,
      ),
    ).rejects.toThrow();
    expect(
      repository.getSnapshot().goals.find((item) => item.id === goal.id)?.name,
    ).toBe("Trip");
  });
});
