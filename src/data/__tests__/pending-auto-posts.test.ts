import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { BudgetInput } from "@/data/repository";

/**
 * The widgets refresh without generating recurring transactions, so they read the due auto-post
 * occurrences through a read-only preview. These tests pin that the preview is exactly what a
 * generation run would write, and that looking at it changes nothing.
 */

const at = (iso: string) => jest.setSystemTime(new Date(`${iso}T09:00:00Z`));

async function createRepository(storage = new MemoryStorageAdapter()) {
  const repository = new LocalFinanceRepository(storage);
  await repository.initialize();
  await repository.completeOnboarding({
    locale: "en-US",
    baseCurrency: "USD",
    accountName: "Everyday",
    accountType: "checking",
    openingBalanceMinor: 100_000,
    themeMode: "system",
    accentSource: "system",
    accentHex: "#5966E9",
  });
  return repository;
}

const monthlyBudget = (): BudgetInput => ({
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
});

async function addRule(
  repository: LocalFinanceRepository,
  overrides: {
    kind?: "expense" | "income";
    title?: string;
    amountMinor?: number;
    startDate: string;
    autoPost: boolean;
  },
) {
  const account = repository.getSnapshot().accounts[0];
  return repository.saveRecurringRule({
    template: {
      kind: overrides.kind ?? "expense",
      title: overrides.title ?? "Gym",
      note: "",
      accountId: account.id,
      categoryId: null,
      tagIds: [],
      amountMinor: overrides.amountMinor ?? 2_500,
      currency: "USD",
    },
    unit: "week",
    interval: 1,
    startDate: overrides.startDate,
    endDate: null,
    nextDueDate: overrides.startDate,
    autoPost: overrides.autoPost,
    active: true,
  });
}

/** Ids and timestamps differ between a preview and a stored row; everything else must match. */
function withoutIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIdentity);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key))
        .map(([key, item]) => [key, withoutIdentity(item)]),
    );
  }
  return value;
}

describe("pending auto-posts", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-01");
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("is empty when nothing is due", async () => {
    const repository = await createRepository();
    expect(repository.getPendingAutoPosts("2026-06-01")).toEqual([]);
    await addRule(repository, { startDate: "2026-06-20", autoPost: true });
    // A schedule that is not auto-post is never previewed as posted.
    await addRule(repository, { startDate: "2026-06-02", autoPost: false });
    expect(repository.getPendingAutoPosts("2026-06-01")).toEqual([]);
    const before = repository.getDashboard("2026-06-01", "2026-06-01");
    expect(
      repository.getDashboard("2026-06-01", "2026-06-01", {
        includePendingAutoPosts: true,
      }),
    ).toEqual(before);
  });

  it("previews the due occurrences with the amounts generation would post", async () => {
    const repository = await createRepository();
    const rule = await addRule(repository, {
      startDate: "2026-06-03",
      autoPost: true,
    });
    at("2026-06-18");
    const pending = repository.getPendingAutoPosts("2026-06-18");
    expect(pending.map((item) => item.localDate)).toEqual([
      "2026-06-03",
      "2026-06-10",
      "2026-06-17",
    ]);
    for (const item of pending) {
      expect(item).toMatchObject({
        status: "posted",
        kind: "expense",
        amountMinor: 2_500,
        baseAmountMinor: 2_500,
        currency: "USD",
        recurringRuleId: rule.id,
        occurrenceKey: `${rule.id}:${item.localDate}`,
      });
    }
  });

  it("gives dashboard and budget numbers equal to those after generating", async () => {
    const repository = await createRepository();
    await repository.saveBudget(monthlyBudget());
    await addRule(repository, { startDate: "2026-06-03", autoPost: true });
    await addRule(repository, {
      kind: "income",
      title: "Side job",
      amountMinor: 7_000,
      startDate: "2026-06-05",
      autoPost: true,
    });
    await addRule(repository, {
      title: "Manual",
      startDate: "2026-06-04",
      autoPost: false,
    });
    at("2026-06-18");

    const options = { includePendingAutoPosts: true };
    const previewDashboard = repository.getDashboard(
      "2026-06-01",
      "2026-06-18",
      options,
    );
    const previewBudgets = repository.getBudgetStatuses("2026-06-18", options);
    // The preview moved the numbers; otherwise this test would prove nothing.
    expect(previewDashboard.expenseMinor).toBeGreaterThan(
      repository.getDashboard("2026-06-01", "2026-06-18").expenseMinor,
    );

    await repository.generateRecurring("2026-06-18");
    const dashboard = repository.getDashboard("2026-06-01", "2026-06-18");
    expect(withoutIdentity(previewDashboard)).toEqual(
      withoutIdentity(dashboard),
    );
    expect(previewDashboard.netWorthMinor).toBe(dashboard.netWorthMinor);
    expect(previewDashboard.incomeMinor).toBe(dashboard.incomeMinor);
    expect(previewDashboard.expenseMinor).toBe(dashboard.expenseMinor);
    const budgets = repository.getBudgetStatuses("2026-06-18");
    expect(previewBudgets.map((status) => status.spentMinor)).toEqual(
      budgets.map((status) => status.spentMinor),
    );
    expect(previewBudgets.map((status) => status.effectiveLimitMinor)).toEqual(
      budgets.map((status) => status.effectiveLimitMinor),
    );
    // Nothing pending is left once generation has run.
    expect(repository.getPendingAutoPosts("2026-06-18")).toEqual([]);
  });

  it("previews an existing upcoming occurrence that generation would post", async () => {
    const repository = await createRepository();
    const rule = await addRule(repository, {
      startDate: "2026-06-10",
      autoPost: true,
    });
    await repository.generateRecurring("2026-06-30");
    const stored = repository
      .getSnapshot()
      .transactions.filter((item) => item.recurringRuleId === rule.id);
    expect(stored.every((item) => item.status === "upcoming")).toBe(true);

    at("2026-06-12");
    const pending = repository.getPendingAutoPosts("2026-06-12");
    expect(pending.map((item) => item.localDate)).toEqual(["2026-06-10"]);
    // The same row, posted, not a second one.
    expect(pending[0].id).toBe(
      stored.find((item) => item.localDate === "2026-06-10")?.id,
    );
  });

  it("does not resurrect an occurrence the user deleted", async () => {
    const repository = await createRepository();
    const rule = await addRule(repository, {
      startDate: "2026-06-03",
      autoPost: true,
    });
    at("2026-06-18");
    await repository.generateRecurring("2026-06-18");
    const june10 = repository
      .getSnapshot()
      .transactions.find(
        (item) => item.occurrenceKey === `${rule.id}:2026-06-10`,
      );
    expect(june10).toBeDefined();
    await repository.deleteEntities("transactions", [june10!.id]);

    expect(repository.getPendingAutoPosts("2026-06-18")).toEqual([]);
    const expected = repository.getDashboard("2026-06-01", "2026-06-18");
    expect(
      repository.getDashboard("2026-06-01", "2026-06-18", {
        includePendingAutoPosts: true,
      }),
    ).toEqual(expected);
    // A later occurrence still previews while the deleted one stays gone.
    at("2026-06-25");
    expect(
      repository
        .getPendingAutoPosts("2026-06-25")
        .map((item) => item.localDate),
    ).toEqual(["2026-06-24"]);
  });

  it("changes nothing: no state, no events, no stored rows", async () => {
    const storage = new MemoryStorageAdapter();
    const repository = await createRepository(storage);
    await repository.saveBudget(monthlyBudget());
    await addRule(repository, { startDate: "2026-06-03", autoPost: true });
    at("2026-06-18");
    const putMany = jest.spyOn(storage, "putMany");
    const listener = jest.fn();
    repository.subscribe(listener);
    const state = repository.getSnapshot();
    const copy = JSON.stringify(state);

    repository.getPendingAutoPosts("2026-06-18");
    const options = { includePendingAutoPosts: true };
    repository.getDashboard("2026-06-01", "2026-06-18", options);
    repository.getBudgetStatuses("2026-06-18", options);

    expect(putMany).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(repository.getSnapshot()).toBe(state);
    expect(JSON.stringify(repository.getSnapshot())).toBe(copy);
    // The plain reads that follow are not polluted by the preview.
    expect(
      repository.getDashboard("2026-06-01", "2026-06-18").expenseMinor,
    ).toBe(0);
    expect(repository.getBudgetStatuses("2026-06-18")[0].spentMinor).toBe(0);
  });
});
