import { MemoryStorageAdapter } from "@/data/memory-storage";
import {
  readLanguageMigrated,
  readLanguagePreference,
  writeLanguagePreference,
} from "@/data/language-preference-store";
import { migrateLegacyLanguage } from "@/localization/language-store";

const mockState: {
  adapter: MemoryStorageAdapter;
  afterFirstTransact: (() => Promise<void>) | null;
} = {
  adapter: null as unknown as MemoryStorageAdapter,
  afterFirstTransact: null,
};

jest.mock("@/data/local-finance-repository", () => ({
  syncingStorage: {
    transact: async (
      work: Parameters<MemoryStorageAdapter["transact"]>[0],
      options?: Parameters<MemoryStorageAdapter["transact"]>[1],
    ) => {
      const result = await mockState.adapter.transact(work, options);
      const hook = mockState.afterFirstTransact;
      mockState.afterFirstTransact = null;
      if (hook) await hook();
      return result;
    },
  },
}));

const input = {
  currentPreference: "system",
  legacyLocale: "he-IL",
  deviceLocales: ["en-US"],
};

beforeEach(async () => {
  mockState.adapter = new MemoryStorageAdapter();
  await mockState.adapter.initialize();
  mockState.afterFirstTransact = null;
});

describe("migrateLegacyLanguage", () => {
  it("pins the legacy language and records the migration", async () => {
    expect(await migrateLegacyLanguage(input)).toBe("he-IL");
    expect(
      await mockState.adapter.transact((tx) => readLanguagePreference(tx)),
    ).toBe("he-IL");
    expect(
      await mockState.adapter.transact((tx) => readLanguageMigrated(tx)),
    ).toBe(true);
    expect(await migrateLegacyLanguage(input)).toBeNull();
  });

  it("does not overwrite a choice made while the migration was running", async () => {
    mockState.afterFirstTransact = () =>
      mockState.adapter.transact((tx) => writeLanguagePreference(tx, "en-US"));
    expect(await migrateLegacyLanguage(input)).toBeNull();
    expect(
      await mockState.adapter.transact((tx) => readLanguagePreference(tx)),
    ).toBe("en-US");
    expect(
      await mockState.adapter.transact((tx) => readLanguageMigrated(tx)),
    ).toBe(true);
  });
});
