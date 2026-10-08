import type { ImportBundle } from "@/data/import/types";
import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { StorageAdapter } from "@/data/storage-adapter";
import { parseCsvText } from "@/utils/csv";

/**
 * An upcoming transaction on a foreign-currency account is stored without a rate snapshot until
 * it is paid. These tests pin that contract: import and generation accept it, paying it snapshots
 * the latest rate on or before today, and a posted row still needs its rate.
 */

const NOW = new Date("2026-07-15T09:00:00Z");

async function createRepository(
  storage: StorageAdapter = new MemoryStorageAdapter(),
) {
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

async function withClock(work: () => Promise<void>) {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(NOW);
    await work();
  } finally {
    jest.useRealTimers();
  }
}

const euroAccount = {
  name: "Euro",
  type: "checking" as const,
  currency: "EUR",
  openingBalanceMinor: 0,
  icon: "wallet",
  color: "#5966E9",
  archived: false,
};

/** A Cashew-style backup: one foreign account, a future upcoming row, and its schedule. */
function foreignUpcomingBundle(
  transactions: ImportBundle["transactions"] = [],
): ImportBundle {
  return {
    source: "cashew",
    timeZone: "UTC",
    timeZoneSource: "device",
    accounts: [
      {
        externalId: "a-eur",
        name: "Euro",
        type: "checking",
        currency: "EUR",
        openingBalanceMinor: 0,
        icon: "wallet",
        color: "#5966E9",
        archived: false,
      },
    ],
    categories: [],
    tags: [],
    transactions: transactions.length
      ? transactions
      : [
          {
            externalId: "x-insurance",
            kind: "expense",
            status: "upcoming",
            title: "Insurance",
            note: "",
            localDate: "2026-08-05",
            accountExternalId: "a-eur",
            destinationAccountExternalId: null,
            categoryExternalId: null,
            tagExternalIds: [],
            amountMinor: 2500,
            destinationAmountMinor: null,
            recurringRuleExternalId: "r-insurance",
          },
        ],
    recurringRules: [
      {
        externalId: "r-insurance",
        kind: "expense",
        title: "Insurance",
        note: "",
        accountExternalId: "a-eur",
        categoryExternalId: null,
        tagExternalIds: [],
        amountMinor: 2500,
        currency: "EUR",
        unit: "month",
        interval: 1,
        startDate: "2026-08-05",
        endDate: null,
        nextDueDate: "2026-08-05",
        autoPost: false,
        active: true,
      },
    ],
    budgets: [],
    report: {
      counts: {
        accounts: 1,
        categories: 0,
        tags: 0,
        transactions: 1,
        recurringRules: 1,
        budgets: 0,
      },
      warnings: [],
      balanceChecks: [],
    },
  };
}

describe("unpriced upcoming transactions", () => {
  it("imports upcoming rows on a foreign account with no stored rate", async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const preview = await repository.importExternalBundle(
        foreignUpcomingBundle(),
        { mode: "merge" },
      );
      expect(preview.rejected).toEqual([]);

      const outcome = await repository.importExternalBundle(
        foreignUpcomingBundle(),
        { mode: "merge" },
        true,
      );
      expect(outcome.committed).toBe(true);
      const insurance = repository
        .getSnapshot()
        .transactions.find((item) => item.title === "Insurance");
      expect(insurance).toMatchObject({
        status: "upcoming",
        localDate: "2026-08-05",
        exchangeRate: null,
        baseAmountMinor: null,
      });
    });
  });

  it("snapshots the latest rate on or before today when an upcoming row is paid", async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const eur = await repository.saveAccount(euroAccount);
      const upcoming = await repository.saveTransaction({
        kind: "expense",
        status: "upcoming",
        title: "Insurance",
        localDate: "2026-08-05",
        accountId: eur.id,
        amountMinor: 2500,
      });
      expect(upcoming).toMatchObject({ exchangeRate: null, baseAmountMinor: null });

      // Dated before today: the one that applies.
      await repository.saveExchangeRate({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.5",
        effectiveDate: "2026-06-01",
      });
      await repository.saveExchangeRate({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.8",
        effectiveDate: "2026-07-10",
      });
      // Dated after today but before the row's own date: must not be used when paying today.
      await repository.saveExchangeRate({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "2.5",
        effectiveDate: "2026-08-01",
      });

      await repository.confirmUpcoming(upcoming.id);
      expect(
        repository.getSnapshot().transactions.find((item) => item.id === upcoming.id),
      ).toMatchObject({
        status: "posted",
        localDate: "2026-08-05",
        exchangeRate: "1.8",
        baseAmountMinor: 4500,
      });
    });
  });

  it("keeps an unpriced row upcoming when paying it has no stored rate", async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const eur = await repository.saveAccount(euroAccount);
      const upcoming = await repository.saveTransaction({
        kind: "expense",
        status: "upcoming",
        title: "Insurance",
        localDate: "2026-08-05",
        accountId: eur.id,
        amountMinor: 2500,
      });

      await expect(repository.confirmUpcoming(upcoming.id)).rejects.toThrow(
        "Missing exchange rate for EUR → USD",
      );
      expect(
        repository.getSnapshot().transactions.find((item) => item.id === upcoming.id),
      ).toMatchObject({
        status: "upcoming",
        exchangeRate: null,
        baseAmountMinor: null,
      });
    });
  });

  it("keeps a snapshot that already exists when paying, and generates a rate-less next occurrence", async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const eur = await repository.saveAccount(euroAccount);
      const rate = await repository.saveExchangeRate({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.9",
        effectiveDate: "2026-07-01",
      });
      await repository.saveRecurringRule({
        template: {
          kind: "expense",
          title: "Insurance",
          note: "",
          accountId: eur.id,
          categoryId: null,
          tagIds: [],
          amountMinor: 2500,
          currency: "EUR",
        },
        unit: "month",
        interval: 1,
        startDate: "2026-07-20",
        endDate: null,
        nextDueDate: "2026-07-20",
        autoPost: false,
        active: true,
      });
      // The first occurrence is priced while the rate exists.
      await repository.generateRecurring("2026-07-20");
      // The rate disappears. The occurrence keeps the snapshot it already has.
      await repository.deleteEntities("exchangeRates", [rate.id]);

      const first = repository
        .getSnapshot()
        .transactions.find((item) => item.localDate === "2026-07-20")!;
      expect(first).toMatchObject({ exchangeRate: "1.9", baseAmountMinor: 4750 });

      await repository.confirmUpcoming(first.id);
      expect(
        repository.getSnapshot().transactions.find((item) => item.id === first.id),
      ).toMatchObject({
        status: "posted",
        exchangeRate: "1.9",
        baseAmountMinor: 4750,
      });

      // Paying generated the next occurrence, which has no rate to use.
      const next = repository
        .getSnapshot()
        .transactions.find((item) => item.localDate === "2026-08-20");
      expect(next).toMatchObject({
        status: "upcoming",
        exchangeRate: null,
        baseAmountMinor: null,
      });
    });
  });

  it("still rejects a posted row that has no exchange rate on import", async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const bundle = foreignUpcomingBundle([
        {
          externalId: "x-paid",
          kind: "expense",
          status: "posted",
          title: "Paid bill",
          note: "",
          localDate: "2026-07-10",
          accountExternalId: "a-eur",
          destinationAccountExternalId: null,
          categoryExternalId: null,
          tagExternalIds: [],
          amountMinor: 2500,
          destinationAmountMinor: null,
          recurringRuleExternalId: null,
        },
      ]);
      const preview = await repository.importExternalBundle(bundle, {
        mode: "merge",
      });
      expect(preview.rejected.map((item) => item.externalId)).toEqual([
        "x-paid",
      ]);
      await expect(
        repository.importExternalBundle(bundle, { mode: "merge" }, true),
      ).rejects.toThrow("Import blocked");
      expect(repository.getSnapshot().transactions).toHaveLength(0);
    });
  });

  it("round-trips a rate-less upcoming row through CSV", async () => {
    await withClock(async () => {
      const { repository } = await createRepository();
      const eur = await repository.saveAccount(euroAccount);
      await repository.saveTransaction({
        kind: "expense",
        status: "upcoming",
        title: "Insurance",
        localDate: "2026-08-05",
        accountId: eur.id,
        amountMinor: 2500,
      });
      const csv = repository.exportCsv();
      const rows = parseCsvText(csv);

      const { repository: target } = await createRepository();
      await target.saveAccount(euroAccount);
      const preview = await target.importCsv(rows as never, false);
      expect(preview.rejectedRows).toEqual([]);
      await target.importCsv(rows as never, true);

      expect(
        target
          .getSnapshot()
          .transactions.find((item) => item.title === "Insurance"),
      ).toMatchObject({
        status: "upcoming",
        localDate: "2026-08-05",
        amountMinor: 2500,
        exchangeRate: null,
        baseAmountMinor: null,
      });
    });
  });
});
