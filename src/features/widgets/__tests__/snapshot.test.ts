import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { Account, TransactionRecord } from "@/domain/models";
import type { WidgetPalettes } from "@/features/widgets/palette";
import {
  MASKED_AMOUNT,
  MAX_WIDGET_ROWS,
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
  const savings = await repository.saveAccount({
    name: "Savings",
    type: "savings",
    currency: "USD",
    openingBalanceMinor: 0,
    icon: "leaf",
    color: "#2E7D32",
    archived: false,
  });
  return { repository, everyday, savings };
}

type Repo = Awaited<ReturnType<typeof setup>>["repository"];

const sourceOf = (repository: Repo): WidgetDataSource => {
  const state = repository.getSnapshot();
  return {
    accounts: state.accounts,
    categories: state.categories,
    queryTransactions: (query) => repository.queryTransactions(query),
    getDashboard: (from, to) => repository.getDashboard(from, to),
    getNetWorthSeries: (months, today) =>
      repository.getNetWorthSeries(months, today),
  };
};

const identity = (message: string) => message;

function build(
  repository: Repo,
  settings: Partial<WidgetSettings> & Pick<WidgetSettings, "widgets">,
  options: {
    placed?: { id: number; kind: "transactions" | "summary" }[];
    t?: (message: string) => string;
    source?: WidgetDataSource;
  } = {},
) {
  return buildWidgetSnapshot({
    placed: options.placed ?? [{ id: 1, kind: "transactions" }],
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
  status: "posted" | "upcoming" = "posted",
) =>
  repository.saveTransaction({
    kind: "expense",
    title,
    localDate,
    accountId,
    amountMinor,
    status,
  });

describe("buildWidgetSnapshot", () => {
  it("produces the version-1 envelope with labels and per-widget style", async () => {
    const { repository } = await setup();
    const snapshot = build(repository, {
      widgets: {
        "1": { ...defaultWidgetConfig("transactions"), opacity: 80 },
      },
    });
    expect(snapshot).toMatchObject({
      version: 1,
      generatedAt: NOW.toISOString(),
      hideAmounts: false,
      labels: {
        netWorth: "Net worth",
        spent: "Spent",
        earned: "Income",
        upcoming: "Upcoming",
        recent: "Recent activity",
        add: "Add transaction",
        empty: "No transactions yet",
        openApp: "Open Qashy to load your widget",
      },
    });
    expect(snapshot.widgets["1"]).toMatchObject({
      kind: "transactions",
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
    expect(snapshot.widgets["1"].summary).toBeUndefined();
  });

  it("runs every label and heading through the translator", async () => {
    const { repository, everyday } = await setup();
    await expense(
      repository,
      everyday.id,
      "Rent",
      "2026-08-01",
      500,
      "upcoming",
    );
    const snapshot = build(
      repository,
      { widgets: {} },
      { t: (message) => `«${message}»` },
    );
    expect(snapshot.labels.netWorth).toBe("«Net worth»");
    expect(snapshot.labels.openApp).toBe("«Open Qashy to load your widget»");
    expect(snapshot.widgets["1"].transactions?.title).toBe("«Transactions»");
    expect(snapshot.widgets["1"].transactions?.groups[0].heading).toBe(
      "«Upcoming»",
    );
  });

  describe("transactions", () => {
    it("groups posted rows newest first under date headings, and gives none when empty", async () => {
      const { repository, everyday } = await setup();
      expect(
        build(repository, { widgets: {} }).widgets["1"].transactions,
      ).toEqual({ title: "Transactions", groups: [] });

      await expense(repository, everyday.id, "Coffee", "2026-07-14", 450);
      await expense(repository, everyday.id, "Lunch", "2026-07-14", 1250);
      await expense(repository, everyday.id, "Old", "2025-12-31", 99);
      const { groups } = build(repository, { widgets: {} }).widgets["1"]
        .transactions!;
      expect(groups.map((group) => group.heading)).toEqual([
        "Tuesday, Jul 14",
        "Wed, Dec 31, 2025",
      ]);
      expect(groups[0].rows).toHaveLength(2);
      expect(groups[0].rows[0]).toMatchObject({
        detail: "Everyday",
        tone: "negative",
      });
      expect(groups[0].rows.map((row) => row.amount).sort()).toEqual([
        "-$12.50",
        "-$4.50",
      ]);
    });

    it("puts upcoming first, soonest first, and leaves skipped out", async () => {
      const { repository, everyday } = await setup();
      await expense(
        repository,
        everyday.id,
        "Later",
        "2026-08-20",
        300,
        "upcoming",
      );
      await expense(
        repository,
        everyday.id,
        "Sooner",
        "2026-07-20",
        200,
        "upcoming",
      );
      const skipped = await expense(
        repository,
        everyday.id,
        "Skipped",
        "2026-07-18",
        100,
        "upcoming",
      );
      await repository.skipUpcoming(skipped.id);
      await expense(repository, everyday.id, "Posted", "2026-07-10", 500);

      const { groups } = build(repository, { widgets: {} }).widgets["1"]
        .transactions!;
      expect(groups[0].heading).toBe("Upcoming");
      expect(groups[0].rows.map((row) => row.title)).toEqual([
        "Sooner",
        "Later",
      ]);
      const titles = groups.flatMap((group) =>
        group.rows.map((row) => row.title),
      );
      expect(titles).toEqual(["Sooner", "Later", "Posted"]);
      expect(titles).not.toContain("Skipped");
    });

    it("caps the list at 30 rows, counting upcoming first", async () => {
      const { repository, everyday } = await setup();
      const day = (index: number) =>
        `2026-06-${String((index % 28) + 1).padStart(2, "0")}`;
      for (let index = 0; index < 35; index += 1)
        await expense(repository, everyday.id, `Row ${index}`, day(index), 100);
      let rows = build(repository, { widgets: {} }).widgets[
        "1"
      ].transactions!.groups.flatMap((group) => group.rows);
      expect(rows).toHaveLength(MAX_WIDGET_ROWS);

      for (let index = 0; index < 3; index += 1)
        await expense(
          repository,
          everyday.id,
          `Due ${index}`,
          `2026-08-0${index + 1}`,
          100,
          "upcoming",
        );
      const groups = build(repository, { widgets: {} }).widgets["1"]
        .transactions!.groups;
      rows = groups.flatMap((group) => group.rows);
      expect(rows).toHaveLength(MAX_WIDGET_ROWS);
      expect(groups[0].rows).toHaveLength(3);
    });

    it("filters to the configured account and uses its name as the title", async () => {
      const { repository, everyday, savings } = await setup();
      await expense(repository, everyday.id, "Everyday spend", "2026-07-10");
      await expense(repository, savings.id, "Savings spend", "2026-07-11");
      const { title, groups } = build(repository, {
        widgets: {
          "1": {
            ...defaultWidgetConfig("transactions"),
            accountId: savings.id,
          },
        },
      }).widgets["1"].transactions!;
      expect(title).toBe("Savings");
      expect(groups.flatMap((g) => g.rows.map((r) => r.title))).toEqual([
        "Savings spend",
      ]);
    });

    it("falls back to all accounts when the account is missing or archived", async () => {
      const { repository, everyday, savings } = await setup();
      await expense(repository, everyday.id, "A", "2026-07-10");
      await expense(repository, savings.id, "B", "2026-07-11");
      const titlesFor = (accountId: string) =>
        build(repository, {
          widgets: {
            "1": { ...defaultWidgetConfig("transactions"), accountId },
          },
        }).widgets["1"].transactions!;

      const missing = titlesFor("no-such-account");
      expect(missing.title).toBe("Transactions");
      expect(missing.groups.flatMap((g) => g.rows)).toHaveLength(2);

      await repository.saveAccount(
        {
          name: savings.name,
          type: savings.type,
          currency: savings.currency,
          openingBalanceMinor: 0,
          icon: savings.icon,
          color: savings.color,
          archived: true,
        },
        savings.id,
      );
      const archived = titlesFor(savings.id);
      expect(archived.title).toBe("Transactions");
      expect(archived.groups.flatMap((g) => g.rows)).toHaveLength(2);
    });

    it("shows a transfer as From → To, unsigned and neutral", async () => {
      const { repository, everyday, savings } = await setup();
      await repository.saveTransaction({
        kind: "transfer",
        title: "Top up",
        localDate: "2026-07-12",
        accountId: everyday.id,
        destinationAccountId: savings.id,
        amountMinor: 25000,
      });
      const [row] = build(repository, { widgets: {} }).widgets["1"]
        .transactions!.groups[0].rows;
      expect(row).toMatchObject({
        title: "Top up",
        detail: "Everyday → Savings",
        amount: "$250.00",
        tone: "neutral",
      });
    });

    it("shows income as positive with a plus sign", async () => {
      const { repository, everyday } = await setup();
      await repository.saveTransaction({
        kind: "income",
        title: "Pay",
        localDate: "2026-07-12",
        accountId: everyday.id,
        amountMinor: 300000,
      });
      const [row] = build(repository, { widgets: {} }).widgets["1"]
        .transactions!.groups[0].rows;
      expect(row).toMatchObject({ amount: "+$3,000.00", tone: "positive" });
    });

    it("titles an untitled row with its category, else the kind label", () => {
      const account = { id: "a1", name: "Cash", archived: false } as Account;
      const record = (patch: Partial<TransactionRecord>) =>
        ({
          id: "t",
          kind: "expense",
          status: "posted",
          title: "  ",
          localDate: "2026-07-10",
          accountId: "a1",
          destinationAccountId: null,
          categoryId: null,
          amountMinor: 100,
          currency: "USD",
          ...patch,
        }) as TransactionRecord;
      const rows = [
        record({ id: "1", categoryId: "c1" }),
        record({ id: "2" }),
        record({ id: "3", kind: "transfer", destinationAccountId: "gone" }),
      ];
      const source: WidgetDataSource = {
        accounts: [account],
        categories: [{ id: "c1", name: "Groceries" } as never],
        queryTransactions: (query) =>
          query.statuses?.includes("posted") ? rows : [],
        getDashboard: () => ({
          incomeMinor: 0,
          expenseMinor: 0,
          netWorthMinor: 0,
        }),
        getNetWorthSeries: () => ({ baseCurrency: "USD", points: [] }),
      };
      const { groups } = build({} as Repo, { widgets: {} }, { source }).widgets[
        "1"
      ].transactions!;
      expect(groups[0].rows.map((row) => row.title)).toEqual([
        "Groceries",
        "Uncategorized",
        "Transfer",
      ]);
      expect(groups[0].rows[2].detail).toBe("Cash → Unknown account");
    });

    it("masks every amount when amounts are hidden", async () => {
      const { repository, everyday, savings } = await setup();
      await expense(repository, everyday.id, "Coffee", "2026-07-14", 450);
      await expense(
        repository,
        everyday.id,
        "Due",
        "2026-08-01",
        450,
        "upcoming",
      );
      await repository.saveTransaction({
        kind: "transfer",
        title: "Move",
        localDate: "2026-07-13",
        accountId: everyday.id,
        destinationAccountId: savings.id,
        amountMinor: 5000,
      });
      const { groups } = build(repository, {
        hideAmounts: true,
        widgets: {},
      }).widgets["1"].transactions!;
      const rows = groups.flatMap((group) => group.rows);
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.amount === MASKED_AMOUNT)).toBe(true);
      // Tone is not an amount: the colour hint survives.
      expect(rows.map((row) => row.tone).sort()).toEqual([
        "negative",
        "negative",
        "neutral",
      ]);
    });
  });

  describe("summary", () => {
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
      const entry = build(
        repository,
        {
          widgets: {
            "9": { ...defaultWidgetConfig("summary"), graphMonths: 6 },
          },
        },
        { placed: [{ id: 9, kind: "summary" }] },
      ).widgets["9"];
      expect(entry.kind).toBe("summary");
      expect(entry.transactions).toBeUndefined();
      expect(entry.summary).toMatchObject({
        monthLabel: "July 2026",
        spent: "$400.00",
        earned: "$2,500.00",
        // 1000.00 opening - 50 - 400 + 2500
        netWorth: "$3,050.00",
        seriesStart: "Jan 26",
        seriesEnd: "Today",
      });
      expect(entry.summary?.series).toHaveLength(7);
      expect(entry.summary?.series?.at(-1)).toBe(305000);
    });

    it("hides amounts and the line together", async () => {
      const { repository } = await withHistory();
      const snapshot = build(
        repository,
        { hideAmounts: true, widgets: {} },
        { placed: [{ id: 9, kind: "summary" }] },
      );
      expect(snapshot.hideAmounts).toBe(true);
      expect(snapshot.widgets["9"].summary).toMatchObject({
        netWorth: MASKED_AMOUNT,
        spent: MASKED_AMOUNT,
        earned: MASKED_AMOUNT,
        series: null,
      });
      expect(JSON.stringify(snapshot)).not.toContain("3,050");
    });

    it("follows the configured graph length", async () => {
      const { repository } = await withHistory();
      const length = (graphMonths: 3 | 6 | 12) =>
        build(
          repository,
          {
            widgets: {
              "9": { ...defaultWidgetConfig("summary"), graphMonths },
            },
          },
          { placed: [{ id: 9, kind: "summary" }] },
        ).widgets["9"].summary?.series?.length;
      expect([length(3), length(6), length(12)]).toEqual([4, 7, 13]);
    });
  });

  it("builds one entry per placed widget, defaulting the ones without a config", async () => {
    const { repository } = await setup();
    const snapshot = build(
      repository,
      { widgets: {} },
      {
        placed: [
          { id: 4, kind: "transactions" },
          { id: 5, kind: "summary" },
        ],
      },
    );
    expect(Object.keys(snapshot.widgets).sort()).toEqual(["4", "5"]);
    expect(snapshot.widgets["5"].kind).toBe("summary");
  });
});
