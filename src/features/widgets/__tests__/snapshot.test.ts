import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { BudgetInput } from "@/data/repository";
import type { WidgetPalettes } from "@/features/widgets/palette";
import {
  MASKED_AMOUNT,
  SNAPSHOT_VERSION,
  buildWidgetSnapshot,
  type WidgetDataSource,
} from "@/features/widgets/snapshot";
import {
  defaultWidgetConfig,
  type WidgetSettings,
} from "@/features/widgets/settings";

const TODAY = "2026-07-15";
const NOW = new Date("2026-07-15T10:00:00.000Z");
const PALETTES: WidgetPalettes = {
  light: {
    background: "#FFFFFF",
    text: "#111111",
    textMuted: "#555555",
    accent: "#5070FF",
    onAccent: "#FFFFFF",
    positive: "#007700",
    negative: "#B00020",
    border: "#DDDDDD",
  },
  dark: {
    background: "#000000",
    text: "#EEEEEE",
    textMuted: "#AAAAAA",
    accent: "#9FB0FF",
    onAccent: "#000000",
    positive: "#66DD66",
    negative: "#FF8A80",
    border: "#333333",
  },
};

async function setup() {
  const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
  await repository.initialize();
  await repository.completeOnboarding({
    locale: "en-US",
    baseCurrency: "USD",
    accountName: "Everyday",
    accountType: "checking",
    openingBalanceMinor: 100000,
    themeMode: "system",
    accentSource: "system",
    accentHex: "#5966E9",
  });
  const everyday = repository.getSnapshot().accounts[0];
  return { repository, everyday };
}

type Repo = Awaited<ReturnType<typeof setup>>["repository"];

/** The source the app builds for the widgets: it counts due auto-post occurrences. */
const sourceOf = (repository: Repo): WidgetDataSource => ({
  baseCurrency: repository.getSnapshot().settings.baseCurrency,
  getDashboard: (from, to) =>
    repository.getDashboard(from, to, { includePendingAutoPosts: true }),
  getBudgetStatuses: (onDate) =>
    repository.getBudgetStatuses(onDate, { includePendingAutoPosts: true }),
});

const identity = (message: string) => message;

function build(
  repository: Repo,
  settings: Partial<WidgetSettings> & Pick<WidgetSettings, "widgets">,
  options: {
    placed?: { id: number; kind: "quickAdd" | "budget" }[];
    t?: (message: string) => string;
    source?: WidgetDataSource;
  } = {},
) {
  return buildWidgetSnapshot({
    placed: options.placed ?? [{ id: 1, kind: "quickAdd" }],
    settings: { hideAmounts: false, ...settings },
    source: options.source ?? sourceOf(repository),
    palettes: () => PALETTES,
    t: options.t ?? identity,
    locale: "en-US",
    today: TODAY,
    now: NOW,
  });
}

const expense = (
  repository: Repo,
  accountId: string,
  title: string,
  localDate: string,
  amountMinor = 1000,
) =>
  repository.saveTransaction({
    kind: "expense",
    title,
    localDate,
    accountId,
    amountMinor,
    status: "posted",
  });

const monthly = (overrides: Partial<BudgetInput> = {}): BudgetInput => ({
  name: "Groceries",
  icon: "chart",
  color: "#5966E9",
  limitMinor: 50000,
  period: {
    unit: "month",
    interval: 1,
    anchorDate: "2026-07-01",
    endDate: null,
  },
  rollover: false,
  filters: { accountIds: [], categoryIds: [], tagIds: [] },
  categoryLimits: [],
  archived: false,
  ...overrides,
});

describe("buildWidgetSnapshot", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("produces the version-2 envelope with labels and per-widget style", async () => {
    const { repository } = await setup();
    const snapshot = build(repository, {
      widgets: {
        "1": { ...defaultWidgetConfig("quickAdd"), opacity: 80 },
      },
    });
    expect(SNAPSHOT_VERSION).toBe(2);
    expect(snapshot).toMatchObject({
      version: 2,
      generatedAt: NOW.toISOString(),
      hideAmounts: false,
      labels: {
        netWorth: "Net worth",
        spent: "Spent",
        earned: "Income",
        add: "Add transaction",
        openApp: "Open Qashy to load your widget",
      },
    });
    expect(snapshot.widgets["1"]).toMatchObject({
      kind: "quickAdd",
      style: {
        theme: "qashy",
        mode: "system",
        background: "surface",
        opacity: 80,
        frosted: false,
        light: PALETTES.light,
        dark: PALETTES.dark,
      },
    });
    expect(snapshot.widgets["1"].budget).toBeUndefined();
  });

  it("runs every label and heading through the translator", async () => {
    const { repository } = await setup();
    const snapshot = build(
      repository,
      { widgets: {} },
      {
        t: (message) => `«${message}»`,
        placed: [
          { id: 1, kind: "quickAdd" },
          { id: 2, kind: "budget" },
        ],
      },
    );
    expect(snapshot.labels.netWorth).toBe("«Net worth»");
    expect(snapshot.labels.openApp).toBe("«Open Qashy to load your widget»");
    expect(snapshot.widgets["2"].budget?.name).toBe("«Create a budget»");
  });

  describe("quickAdd", () => {
    async function withHistory() {
      const ctx = await setup();
      await expense(
        ctx.repository,
        ctx.everyday.id,
        "Rent",
        "2026-07-03",
        40000,
      );
      await ctx.repository.saveTransaction({
        kind: "income",
        title: "Pay",
        localDate: "2026-07-05",
        accountId: ctx.everyday.id,
        amountMinor: 250000,
      });
      await expense(
        ctx.repository,
        ctx.everyday.id,
        "June",
        "2026-06-20",
        5000,
      );
      return ctx;
    }

    it("reports this month's spending and income and the headline net worth", async () => {
      const { repository } = await withHistory();
      const entry = build(repository, { widgets: {} }).widgets["1"];
      expect(entry.kind).toBe("quickAdd");
      expect(entry.budget).toBeUndefined();
      expect(entry.quickAdd).toEqual({
        monthLabel: "July 2026",
        spent: "$400.00",
        earned: "$2,500.00",
        // 1000.00 opening - 50 - 400 + 2500
        netWorth: "$3,050.00",
      });
    });

    it("leaves a metric that is switched off out of the snapshot", async () => {
      const { repository } = await withHistory();
      const snapshot = build(repository, {
        widgets: {
          "1": {
            ...defaultWidgetConfig("quickAdd"),
            showNetWorth: false,
            showEarned: false,
          },
        },
      });
      expect(snapshot.widgets["1"].quickAdd).toEqual({
        monthLabel: "July 2026",
        netWorth: null,
        spent: "$400.00",
        earned: null,
      });
      const json = JSON.stringify(snapshot);
      expect(json).not.toContain("3,050");
      expect(json).not.toContain("2,500");
    });

    it("keeps every amount out of the snapshot when amounts are hidden", async () => {
      const { repository } = await withHistory();
      const snapshot = build(repository, { hideAmounts: true, widgets: {} });
      expect(snapshot.hideAmounts).toBe(true);
      expect(snapshot.widgets["1"].quickAdd).toMatchObject({
        netWorth: MASKED_AMOUNT,
        spent: MASKED_AMOUNT,
        earned: MASKED_AMOUNT,
      });
      const json = JSON.stringify(snapshot);
      for (const amount of ["3,050", "400.00", "2,500"])
        expect(json).not.toContain(amount);
    });

    it("counts a due auto-post occurrence that has not been generated yet", async () => {
      const { repository, everyday } = await setup();
      // A new rule starts at its first occurrence from today on, so save it before the due date.
      jest.setSystemTime(new Date("2026-07-01T10:00:00.000Z"));
      await repository.saveRecurringRule({
        template: {
          kind: "expense",
          title: "Gym",
          note: "",
          accountId: everyday.id,
          categoryId: null,
          tagIds: [],
          amountMinor: 3000,
          currency: "USD",
        },
        unit: "month",
        interval: 1,
        startDate: "2026-07-10",
        endDate: null,
        nextDueDate: "2026-07-10",
        autoPost: true,
        active: true,
      });
      jest.setSystemTime(NOW);
      // Nothing generated the 10th's occurrence, and reading it must not write it.
      const before = repository.getSnapshot().transactions.length;
      const entry = build(repository, { widgets: {} }).widgets["1"];
      expect(entry.quickAdd?.spent).toBe("$30.00");
      expect(entry.quickAdd?.netWorth).toBe("$970.00");
      expect(repository.getSnapshot().transactions).toHaveLength(before);
    });
  });

  describe("budget", () => {
    const placed = [{ id: 1, kind: "budget" as const }];

    it("is an empty state that asks for a budget when there is none", async () => {
      const { repository } = await setup();
      const entry = build(repository, { widgets: {} }, { placed }).widgets["1"];
      expect(entry.kind).toBe("budget");
      expect(entry.quickAdd).toBeUndefined();
      expect(entry.budget).toMatchObject({
        empty: true,
        name: "Create a budget",
        spent: null,
        limit: null,
        remaining: null,
      });
    });

    it("shows the first budget's progress, remaining amount and pace", async () => {
      const { repository, everyday } = await setup();
      await repository.saveBudget(monthly());
      await expense(repository, everyday.id, "Food", "2026-07-08", 12500);
      const { budget } = build(repository, { widgets: {} }, { placed }).widgets[
        "1"
      ];
      expect(budget).toMatchObject({
        empty: false,
        name: "Groceries",
        period: "July 2026",
        percent: 25,
        progress: 0.25,
        over: false,
        status: "under",
        statusText: "Under pace",
        spent: "$125.00",
        limit: "$500.00",
        remaining: "$375.00 left",
      });
      // 15 of 31 days.
      expect(budget?.elapsed).toBeCloseTo(15 / 31);
    });

    it("says over budget in words, with the overspent amount", async () => {
      const { repository, everyday } = await setup();
      await repository.saveBudget(monthly());
      await expense(repository, everyday.id, "Feast", "2026-07-08", 60000);
      const { budget } = build(repository, { widgets: {} }, { placed }).widgets[
        "1"
      ];
      expect(budget).toMatchObject({
        over: true,
        percent: 120,
        progress: 1,
        status: "over",
        statusText: "Over budget",
        remaining: "$100.00 over",
      });
    });

    it("uses the effective limit, with adjustments, as the Plan screen does", async () => {
      const { repository, everyday } = await setup();
      const saved = await repository.saveBudget(monthly());
      await repository.addBudgetAdjustment({
        budgetId: saved.id,
        amountMinor: 50000,
        note: "",
      });
      await expense(repository, everyday.id, "Food", "2026-07-08", 25000);
      const [status] = repository.getBudgetStatuses(TODAY);
      expect(status.effectiveLimitMinor).toBe(100000);
      const { budget } = build(repository, { widgets: {} }, { placed }).widgets[
        "1"
      ];
      expect(budget).toMatchObject({
        percent: 25,
        limit: "$1,000.00",
        remaining: "$750.00 left",
      });
    });

    it("counts a due auto-post occurrence that has not been generated yet", async () => {
      const { repository, everyday } = await setup();
      await repository.saveBudget(monthly());
      jest.setSystemTime(new Date("2026-07-01T10:00:00.000Z"));
      await repository.saveRecurringRule({
        template: {
          kind: "expense",
          title: "Gym",
          note: "",
          accountId: everyday.id,
          categoryId: null,
          tagIds: [],
          amountMinor: 10000,
          currency: "USD",
        },
        unit: "month",
        interval: 1,
        startDate: "2026-07-10",
        endDate: null,
        nextDueDate: "2026-07-10",
        autoPost: true,
        active: true,
      });
      jest.setSystemTime(NOW);
      const { budget } = build(repository, { widgets: {} }, { placed }).widgets[
        "1"
      ];
      expect(budget).toMatchObject({ percent: 20, spent: "$100.00" });
    });

    it("follows the configured budget, and falls back to the first active one", async () => {
      const { repository } = await setup();
      const first = await repository.saveBudget(monthly({ name: "First" }));
      const second = await repository.saveBudget(monthly({ name: "Second" }));
      const nameFor = (budgetId: string | null) =>
        build(
          repository,
          { widgets: { "1": { ...defaultWidgetConfig("budget"), budgetId } } },
          { placed },
        ).widgets["1"].budget?.name;
      expect(nameFor(null)).toBe("First");
      expect(nameFor(second.id)).toBe("Second");
      expect(nameFor(first.id)).toBe("First");
      expect(nameFor("no-such-budget")).toBe("First");

      await repository.deleteEntities("budgets", [first.id]);
      expect(nameFor(first.id)).toBe("Second");
    });

    it("does not show a custom budget outside its window", async () => {
      const { repository } = await setup();
      const ended = await repository.saveBudget(
        monthly({
          name: "Trip",
          period: {
            unit: "custom",
            interval: 1,
            anchorDate: "2026-05-01",
            endDate: "2026-05-10",
          },
        }),
      );
      const entry = build(
        repository,
        {
          widgets: {
            "1": { ...defaultWidgetConfig("budget"), budgetId: ended.id },
          },
        },
        { placed },
      ).widgets["1"];
      expect(entry.budget?.empty).toBe(true);
    });

    it("keeps every amount out of the snapshot when amounts are hidden", async () => {
      const { repository, everyday } = await setup();
      await repository.saveBudget(monthly());
      await expense(repository, everyday.id, "Food", "2026-07-08", 12500);
      const snapshot = build(
        repository,
        { hideAmounts: true, widgets: {} },
        { placed },
      );
      // The percentage and the pace wording are allowed; money is not.
      expect(snapshot.widgets["1"].budget).toMatchObject({
        percent: 25,
        statusText: "Under pace",
        spent: null,
        limit: null,
        remaining: null,
      });
      const json = JSON.stringify(snapshot);
      for (const amount of ["125", "500", "375", "$"])
        expect(json).not.toContain(amount);
    });
  });

  it("builds one entry per placed widget, defaulting the ones without a config", async () => {
    const { repository } = await setup();
    const snapshot = build(
      repository,
      { widgets: {} },
      {
        placed: [
          { id: 4, kind: "quickAdd" },
          { id: 5, kind: "budget" },
        ],
      },
    );
    expect(Object.keys(snapshot.widgets).sort()).toEqual(["4", "5"]);
    expect(snapshot.widgets["5"].kind).toBe("budget");
  });
});
