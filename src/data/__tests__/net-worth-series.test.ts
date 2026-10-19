import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { Account } from "@/domain/models";

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
  return { repository, usd: repository.getSnapshot().accounts[0] };
}

type Repo = Awaited<ReturnType<typeof setup>>["repository"];

function addAccount(
  repository: Repo,
  currency: string,
  openingBalanceMinor = 0,
) {
  return repository.saveAccount({
    name: `${currency} ${openingBalanceMinor}`,
    type: "checking",
    currency,
    openingBalanceMinor,
    icon: "wallet",
    color: "#5966E9",
    archived: false,
  });
}

function rate(
  repository: Repo,
  fromCurrency: string,
  value: string,
  date: string,
) {
  return repository.saveExchangeRate({
    fromCurrency,
    toCurrency: "USD",
    rate: value,
    effectiveDate: date,
  });
}

function archive(repository: Repo, account: Account) {
  return repository.saveAccount(
    {
      name: account.name,
      type: account.type,
      currency: account.currency,
      openingBalanceMinor: account.openingBalanceMinor,
      icon: account.icon,
      color: account.color,
      archived: true,
    },
    account.id,
  );
}

const values = (repository: Repo, months: number, today = TODAY) =>
  repository.getNetWorthSeries(months, today).points.map((p) => p.baseMinor);

describe("FinanceRepository.getNetWorthSeries", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
  });
  afterEach(() => jest.useRealTimers());

  it("returns month-end points oldest first, then today", async () => {
    const { repository } = await setup();
    const series = repository.getNetWorthSeries(12);
    expect(series.baseCurrency).toBe("USD");
    expect(series.points).toHaveLength(13);
    expect(series.points[0].date).toBe("2025-07-31");
    expect(series.points[11].date).toBe("2026-06-30");
    expect(series.points[12].date).toBe(TODAY);
    expect(series.missingExchangeRates).toEqual([]);
  });

  it("uses the real last day of 31-day and February months", async () => {
    const { repository } = await setup();
    expect(
      repository.getNetWorthSeries(2, "2026-03-10").points.map((p) => p.date),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-10"]);
    expect(
      repository.getNetWorthSeries(1, "2028-03-10").points.map((p) => p.date),
    ).toEqual(["2028-02-29", "2028-03-10"]);
    expect(
      repository.getNetWorthSeries(2, TODAY).points.map((p) => p.date),
    ).toEqual(["2026-05-31", "2026-06-30", TODAY]);
  });

  it.each([0, 25, 1.5, Number.NaN, -3])("rejects months=%s", async (months) => {
    const { repository } = await setup();
    expect(() => repository.getNetWorthSeries(months)).toThrow();
  });

  it("accepts the 1 and 24 bounds", async () => {
    const { repository } = await setup();
    expect(repository.getNetWorthSeries(1).points).toHaveLength(2);
    expect(repository.getNetWorthSeries(24).points).toHaveLength(25);
  });

  it("applies the opening balance at every point", async () => {
    const { repository } = await setup(12345);
    expect(values(repository, 3)).toEqual([12345, 12345, 12345, 12345]);
  });

  it("counts a posted transaction only from its date onward", async () => {
    const { repository, usd } = await setup(1000);
    await repository.saveTransaction({
      kind: "income",
      title: "Pay",
      localDate: "2026-05-31",
      accountId: usd.id,
      amountMinor: 500,
    });
    await repository.saveTransaction({
      kind: "expense",
      title: "Rent",
      localDate: "2026-06-10",
      accountId: usd.id,
      amountMinor: 200,
    });
    // 2026-04-30, 05-31 (inclusive), 06-30, today
    expect(values(repository, 3)).toEqual([1000, 1500, 1300, 1300]);
  });

  it("excludes upcoming and skipped transactions", async () => {
    const { repository, usd } = await setup(1000);
    await repository.saveTransaction({
      kind: "expense",
      title: "Pending",
      status: "upcoming",
      localDate: "2026-06-10",
      accountId: usd.id,
      amountMinor: 300,
    });
    const skipped = await repository.saveTransaction({
      kind: "expense",
      title: "Skipped",
      status: "upcoming",
      localDate: "2026-06-11",
      accountId: usd.id,
      amountMinor: 400,
    });
    await repository.skipUpcoming(skipped.id);
    expect(values(repository, 2)).toEqual([1000, 1000, 1000]);
  });

  it("leaves a future-dated posted transaction out of earlier points", async () => {
    const { repository, usd } = await setup(1000);
    await repository.saveTransaction({
      kind: "income",
      title: "Early bonus",
      localDate: "2026-08-01",
      accountId: usd.id,
      amountMinor: 700,
    });
    const series = repository.getNetWorthSeries(2);
    expect(series.points.slice(0, 2).map((p) => p.baseMinor)).toEqual([
      1000, 1000,
    ]);
    // The last point is the headline, which counts every posted row.
    expect(series.points[2].baseMinor).toBe(1700);
  });

  it("converts a foreign opening balance at today's rate", async () => {
    const { repository } = await setup(1000);
    await addAccount(repository, "EUR", 2000);
    await rate(repository, "EUR", "2", "2026-01-01");
    await rate(repository, "EUR", "3", "2026-06-01");
    expect(values(repository, 2)).toEqual([7000, 7000, 7000]);
  });

  it("lists a currency with no rate and contributes zero for it", async () => {
    const { repository } = await setup(1000);
    await addAccount(repository, "GBP", 5000);
    const series = repository.getNetWorthSeries(1);
    expect(series.points.map((p) => p.baseMinor)).toEqual([1000, 1000]);
    expect(series.missingExchangeRates).toEqual([
      { fromCurrency: "GBP", toCurrency: "USD" },
    ]);
  });

  it("values expenses and income at their saved base snapshot, not today's rate", async () => {
    const { repository } = await setup();
    const eur = await addAccount(repository, "EUR", 0);
    await rate(repository, "EUR", "2", "2026-01-01");
    await repository.saveTransaction({
      kind: "income",
      title: "Pay",
      localDate: "2026-05-10",
      accountId: eur.id,
      amountMinor: 1000,
    });
    await repository.saveTransaction({
      kind: "expense",
      title: "Shop",
      localDate: "2026-06-10",
      accountId: eur.id,
      amountMinor: 100,
    });
    await rate(repository, "EUR", "3", "2026-06-01");
    // Snapshots: +2000 on 05-10, -200 on 06-10 (rate 2). Today re-prices the 900 EUR balance at 3.
    expect(values(repository, 3)).toEqual([0, 2000, 1800, 2700]);
    expect(repository.getNetWorthSeries(3).points[3].baseMinor).toBe(
      repository.getDashboard("2026-07-01", TODAY).netWorthMinor,
    );
  });

  it("falls back to today's rate when the base snapshot is null", async () => {
    const { repository } = await setup();
    const eur = await addAccount(repository, "EUR", 0);
    await rate(repository, "EUR", "2", "2026-01-01");
    const income = await repository.saveTransaction({
      kind: "income",
      title: "Pay",
      localDate: "2026-05-10",
      accountId: eur.id,
      amountMinor: 1000,
    });
    await rate(repository, "EUR", "3", "2026-06-01");
    // Simulate an unpriced posted row (the snapshot a sync peer may not have carried).
    const stored = repository
      .getSnapshot()
      .transactions.find((item) => item.id === income.id)!;
    stored.baseAmountMinor = null;
    (repository as unknown as { derivedCache: unknown }).derivedCache = null;
    expect(values(repository, 3).slice(0, 3)).toEqual([0, 3000, 3000]);
  });

  it("uses saved base values for a transfer between same-currency foreign accounts", async () => {
    const { repository } = await setup();
    const a = await addAccount(repository, "EUR", 10000);
    const b = await addAccount(repository, "EUR", 0);
    await rate(repository, "EUR", "2", "2026-01-01");
    const transfer = await repository.saveTransaction({
      kind: "transfer",
      title: "Move",
      localDate: "2026-05-10",
      accountId: a.id,
      destinationAccountId: b.id,
      amountMinor: 1000,
    });
    expect(transfer.baseAmountMinor).toBe(2000);
    const stored = repository
      .getSnapshot()
      .transactions.find((item) => item.id === transfer.id)!;
    // Distinct saved legs prove each side reads its own snapshot.
    stored.destinationBaseAmountMinor = 1900;
    (repository as unknown as { derivedCache: unknown }).derivedCache = null;
    await rate(repository, "EUR", "3", "2026-06-01");
    // Opening 100.00 EUR at today's 3 = 30000; the transfer nets -2000 + 1900 before today.
    expect(values(repository, 3).slice(0, 3)).toEqual([30000, 29900, 29900]);
  });

  it("prices both legs of a cross-currency transfer at today's rate", async () => {
    const { repository } = await setup();
    const eur = await addAccount(repository, "EUR", 10000);
    const gbp = await addAccount(repository, "GBP", 0);
    await rate(repository, "EUR", "2", "2026-01-01");
    await rate(repository, "GBP", "4", "2026-01-01");
    await repository.saveTransaction({
      kind: "transfer",
      title: "Convert",
      localDate: "2026-05-10",
      accountId: eur.id,
      destinationAccountId: gbp.id,
      amountMinor: 1000,
      destinationAmountMinor: 500,
    });
    await rate(repository, "EUR", "3", "2026-06-01");
    await rate(repository, "GBP", "5", "2026-06-01");
    // Before: 10000 EUR * 3 = 30000. After: -1000 EUR * 3 and +500 GBP * 5 = -3000 + 2500.
    expect(values(repository, 3).slice(0, 3)).toEqual([30000, 29500, 29500]);
  });

  it("counts a transfer to an archived account on the included side only", async () => {
    const { repository, usd } = await setup(5000);
    const archived = await addAccount(repository, "USD", 0);
    await repository.saveTransaction({
      kind: "transfer",
      title: "Out",
      localDate: "2026-05-10",
      accountId: usd.id,
      destinationAccountId: archived.id,
      amountMinor: 1000,
    });
    await repository.saveTransaction({
      kind: "transfer",
      title: "Back",
      localDate: "2026-06-10",
      accountId: archived.id,
      destinationAccountId: usd.id,
      amountMinor: 300,
    });
    await archive(repository, archived);
    expect(values(repository, 3)).toEqual([5000, 4000, 4300, 4300]);
  });

  it("excludes archived and deleted accounts entirely", async () => {
    const { repository, usd } = await setup(1000);
    const archived = await addAccount(repository, "USD", 9000);
    const doomed = await addAccount(repository, "USD", 7000);
    await repository.saveTransaction({
      kind: "income",
      title: "Hidden",
      localDate: "2026-05-10",
      accountId: archived.id,
      amountMinor: 100,
    });
    await repository.saveTransaction({
      kind: "income",
      title: "Doomed",
      localDate: "2026-05-11",
      accountId: doomed.id,
      amountMinor: 50,
    });
    await archive(repository, archived);
    await repository.deleteEntities("accounts", [doomed.id]);
    expect(usd.id).toBeDefined();
    expect(values(repository, 3)).toEqual([1000, 1000, 1000, 1000]);
  });

  it("ends on the dashboard headline", async () => {
    const { repository, usd } = await setup(1000);
    const eur = await addAccount(repository, "EUR", 500);
    await rate(repository, "EUR", "2", "2026-01-01");
    await repository.saveTransaction({
      kind: "expense",
      title: "Lunch",
      localDate: "2026-07-01",
      accountId: usd.id,
      amountMinor: 250,
    });
    await repository.saveTransaction({
      kind: "income",
      title: "Gift",
      localDate: "2026-07-03",
      accountId: eur.id,
      amountMinor: 100,
    });
    const series = repository.getNetWorthSeries(6);
    const dashboard = repository.getDashboard("2026-07-01", TODAY);
    expect(series.points[series.points.length - 1]).toEqual({
      date: TODAY,
      baseMinor: dashboard.netWorthMinor,
    });
  });
});

describe("FinanceRepository.initialize options", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
  });
  afterEach(() => jest.useRealTimers());

  const recurringCount = (repository: LocalFinanceRepository) =>
    repository.getSnapshot().transactions.filter((t) => t.recurringRuleId)
      .length;

  async function seedDueLater() {
    const storage = new MemoryStorageAdapter();
    const shared = new LocalFinanceRepository(storage);
    await shared.initialize();
    await shared.completeOnboarding({
      locale: "en-US",
      baseCurrency: "USD",
      accountName: "Everyday",
      accountType: "checking",
      openingBalanceMinor: 0,
      themeMode: "system",
      accentSource: "system",
      accentHex: "#5966E9",
    });
    await shared.saveRecurringRule({
      template: {
        kind: "expense",
        title: "Auto",
        note: "",
        accountId: shared.getSnapshot().accounts[0].id,
        categoryId: null,
        tagIds: [],
        amountMinor: 100,
        currency: "USD",
      },
      unit: "month",
      interval: 1,
      startDate: "2026-07-16",
      endDate: null,
      nextDueDate: "2026-07-16",
      autoPost: true,
      active: true,
    });
    jest.setSystemTime(new Date("2026-07-20T09:00:00Z"));
    return storage;
  }

  it("returns the same promise while in flight or done, whatever the options", async () => {
    const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
    const first = repository.initialize({ generateRecurring: false });
    expect(repository.initialize()).toBe(first);
    await first;
    expect(repository.initialize({ generateRecurring: true })).toBe(first);
  });

  it("generates recurring transactions by default", async () => {
    const storage = await seedDueLater();
    const repository = new LocalFinanceRepository(storage);
    await repository.initialize();
    expect(recurringCount(repository)).toBe(1);
  });

  it("posts nothing with generateRecurring: false, and a later generateRecurring still does", async () => {
    const storage = await seedDueLater();
    const repository = new LocalFinanceRepository(storage);
    await repository.initialize({ generateRecurring: false });
    expect(repository.getSnapshot().ready).toBe(true);
    expect(recurringCount(repository)).toBe(0);
    await repository.generateRecurring();
    expect(recurringCount(repository)).toBe(1);
  });
});
