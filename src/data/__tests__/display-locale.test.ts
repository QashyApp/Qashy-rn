import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import * as money from "@/utils/money";

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

/** A EUR account with a manual rate, so saving a transaction converts to the base currency. */
async function saveConvertedTransaction(
  repository: LocalFinanceRepository,
  title = "Lunch",
) {
  const eur = await repository.saveAccount({
    name: "Euros",
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
    rate: "2",
    effectiveDate: "2026-01-01",
  });
  return repository.saveTransaction({
    kind: "expense",
    title,
    localDate: "2026-07-15",
    accountId: eur.id,
    amountMinor: 1000,
  });
}

describe("FinanceRepository.setDisplayLocale", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(["", "   ", "not a locale", "en_US!"])(
    "rejects the invalid locale %p and keeps the previous one",
    async (locale) => {
      const { repository } = await createRepository();
      repository.setDisplayLocale("he-IL");
      expect(() => repository.setDisplayLocale(locale)).toThrow();

      const spy = jest.spyOn(money, "convertMinor");
      await saveConvertedTransaction(repository);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for (const call of spy.mock.calls) expect(call[4]).toBe("he-IL");
    },
  );

  it("falls back to the synced settings locale until it is first called", async () => {
    const { repository } = await createRepository();
    const spy = jest.spyOn(money, "convertMinor");
    await saveConvertedTransaction(repository);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) expect(call[4]).toBe("en-US");
  });

  it("drives locale-dependent repository output instead of settings.locale", async () => {
    const { repository } = await createRepository();
    repository.setDisplayLocale("he-IL");
    const spy = jest.spyOn(money, "convertMinor");
    const saved = await saveConvertedTransaction(repository);

    expect(saved.baseAmountMinor).toBe(2000);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) expect(call[4]).toBe("he-IL");
    expect(repository.getSnapshot().settings.locale).toBe("en-US");
  });

  it("does not persist, change settings, or write anything", async () => {
    const { repository, storage } = await createRepository();
    const before = repository.getSnapshot();
    const putMany = jest.spyOn(storage, "putMany");
    const transact = jest.spyOn(storage, "transact");

    repository.setDisplayLocale("he-IL");

    expect(putMany).not.toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
    const after = repository.getSnapshot();
    expect(after.settings).toBe(before.settings);
    expect(after.settings.locale).toBe("en-US");
    expect(after.settings.revision).toBe(before.settings.revision);

    // A fresh repository over the same storage knows nothing about it.
    const reopened = new LocalFinanceRepository(storage);
    await reopened.initialize();
    expect(reopened.getSnapshot().settings.locale).toBe("en-US");
    const spy = jest.spyOn(money, "convertMinor");
    await saveConvertedTransaction(reopened);
    for (const call of spy.mock.calls) expect(call[4]).toBe("en-US");
  });

  it("emits no sync ops: the storage sees no write and no op is captured", async () => {
    const { repository, storage } = await createRepository();
    const writes = jest.fn();
    jest.spyOn(storage, "transact").mockImplementation(writes);
    repository.setDisplayLocale("he-IL");
    repository.setDisplayLocale("de-DE");
    expect(writes).not.toHaveBeenCalled();
  });

  it("notifies subscribers only when the effective locale changes", async () => {
    const { repository } = await createRepository();
    const listener = jest.fn();
    repository.subscribe(listener);

    repository.setDisplayLocale("he-IL");
    expect(listener).toHaveBeenCalledTimes(1);
    repository.setDisplayLocale("he-IL");
    expect(listener).toHaveBeenCalledTimes(1);
    repository.setDisplayLocale("en-US");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("leaves completeOnboarding's starter names on the locale in its own input", async () => {
    const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
    await repository.initialize();
    repository.setDisplayLocale("he-IL");
    await repository.completeOnboarding({
      locale: "en-US",
      baseCurrency: "USD",
      accountName: "",
      accountType: "checking",
      openingBalanceMinor: 0,
      themeMode: "system",
      accentSource: "system",
      accentHex: "#5966E9",
    });
    const state = repository.getSnapshot();
    expect(state.settings.locale).toBe("en-US");
    expect(state.accounts[0].name).toBe("Everyday");
    expect(state.categories.map((category) => category.name)).toContain(
      "Groceries",
    );
  });
});
