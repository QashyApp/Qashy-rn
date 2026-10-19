import {
  readLanguageMigrated,
  readLanguagePreference,
  writeLanguagePreference,
} from "@/data/language-preference-store";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import {
  migrateLegacyLanguage,
  readDeviceLocales,
  persistPreference,
} from "@/localization/language-store";

const mockState: {
  adapter: MemoryStorageAdapter;
  /** Runs once, right after the first transaction that read the stored language preference. */
  afterPreferenceRead: (() => Promise<void>) | null;
  /** The 1-based transaction number that fails, if any. */
  failTransaction: number | null;
  transactions: number;
} = {
  adapter: null as unknown as MemoryStorageAdapter,
  afterPreferenceRead: null,
  failTransaction: null,
  transactions: 0,
};
const mockLocale = {
  available: false,
  applied: "",
  readFails: false,
  systemFails: false,
  set: async (tags: string): Promise<void> => {
    mockLocale.applied = tags;
  },
};

jest.mock("@/data/local-finance-repository", () => ({
  syncingStorage: {
    transact: async (
      work: Parameters<MemoryStorageAdapter["transact"]>[0],
      options?: Parameters<MemoryStorageAdapter["transact"]>[1],
    ) => {
      const { SYNC_META } =
        jest.requireActual<typeof import("@/data/sync-store")>(
          "@/data/sync-store",
        );
      if (++mockState.transactions === mockState.failTransaction)
        throw new Error("storage failed");
      let readPreference = false;
      // Notes whether this transaction read the stored language, without changing what it does.
      const watched: typeof work = (tx) =>
        work(
          new Proxy(tx, {
            get(target, property) {
              const value = Reflect.get(target, property);
              if (property !== "table") return value;
              return (name: Parameters<typeof tx.table>[0]) => {
                const table = target.table(name);
                return new Proxy(table, {
                  get(inner, key) {
                    const member = Reflect.get(inner, key);
                    if (key !== "getMany") return member;
                    return (keys: readonly string[]) => {
                      if (keys.includes(SYNC_META.appLanguage))
                        readPreference = true;
                      return (
                        member as (keys: readonly string[]) => unknown
                      ).call(inner, keys);
                    };
                  },
                });
              };
            },
          }),
        );
      const result = await mockState.adapter.transact(watched, options);
      const hook = mockState.afterPreferenceRead;
      if (readPreference && hook) {
        mockState.afterPreferenceRead = null;
        await hook();
      }
      return result;
    },
  },
}));

jest.mock("../../../modules/qashy-locale", () => ({
  isAvailable: () => mockLocale.available,
  getApplicationLocales: () => {
    if (mockLocale.readFails) throw new Error("native read failed");
    return mockLocale.applied;
  },
  setApplicationLocales: (tags: string) => mockLocale.set(tags),
  getSystemLocales: () => {
    if (mockLocale.systemFails) throw new Error("native read failed");
    return ["de-DE"];
  },
}));

const input = {
  onboardingComplete: true,
  legacyLocale: "he-IL",
  deviceLocales: ["en-US"],
};

const migrated = () =>
  mockState.adapter.transact((tx) => readLanguageMigrated(tx));
const stored = () =>
  mockState.adapter.transact((tx) => readLanguagePreference(tx));

beforeEach(async () => {
  mockState.adapter = new MemoryStorageAdapter();
  await mockState.adapter.initialize();
  mockState.afterPreferenceRead = null;
  mockState.failTransaction = null;
  mockState.transactions = 0;
  mockLocale.available = false;
  mockLocale.applied = "";
  mockLocale.readFails = false;
  mockLocale.systemFails = false;
  mockLocale.set = async (tags) => {
    mockLocale.applied = tags;
  };
});

describe("migrateLegacyLanguage", () => {
  it("pins the legacy language and records the migration", async () => {
    expect(await migrateLegacyLanguage(input)).toBe("he-IL");
    expect(await stored()).toBe("he-IL");
    expect(await migrated()).toBe(true);
    expect(await migrateLegacyLanguage(input)).toBeNull();
  });

  it("keeps a choice that landed first, and one that lands right after its read", async () => {
    await mockState.adapter.transact((tx) =>
      writeLanguagePreference(tx, "en-US"),
    );
    expect(await migrateLegacyLanguage(input)).toBeNull();
    expect(await stored()).toBe("en-US");
    expect(await migrated()).toBe(true);
  });

  it("decides inside one transaction, so a choice landing after its read is not overwritten", async () => {
    mockState.afterPreferenceRead = () =>
      mockState.adapter.transact((tx) => writeLanguagePreference(tx, "en-US"));
    await migrateLegacyLanguage(input);
    // The choice came after the migration's decision and write, so it is the one that stands.
    expect(await stored()).toBe("en-US");
    expect(await migrated()).toBe(true);
  });

  it("does not pin anything when the current preference is no longer system", async () => {
    mockLocale.available = true;
    mockLocale.applied = "en-US";
    expect(await migrateLegacyLanguage(input)).toBeNull();
    expect(mockLocale.applied).toBe("en-US");
    expect(await migrated()).toBe(true);
  });

  it("still reports the pinned language when only the migrated flag fails to save", async () => {
    mockLocale.available = true;
    // Native path: transaction 1 reads the flag, 2 writes it.
    mockState.failTransaction = 2;
    expect(await migrateLegacyLanguage(input)).toBe("he-IL");
    expect(mockLocale.applied).toBe("he-IL");
    expect(await migrated()).toBe(false);
    // The next launch decides nothing, because native is no longer "system".
    expect(await migrateLegacyLanguage(input)).toBeNull();
    expect(await migrated()).toBe(true);
  });

  it("pins nothing on a fresh install but still records the migration", async () => {
    expect(
      await migrateLegacyLanguage({
        ...input,
        onboardingComplete: false,
        legacyLocale: "en-US",
        deviceLocales: ["de-DE", "he-IL"],
      }),
    ).toBeNull();
    expect(await stored()).toBe("system");
    expect(await migrated()).toBe(true);
  });

  it("leaves the flag unset when the write fails, and retries next time", async () => {
    mockLocale.available = true;
    mockLocale.set = async () => {
      throw new Error("native write failed");
    };
    await expect(migrateLegacyLanguage(input)).rejects.toThrow("native write");
    expect(await migrated()).toBe(false);

    mockLocale.set = async (tags) => {
      mockLocale.applied = tags;
    };
    expect(await migrateLegacyLanguage(input)).toBe("he-IL");
    expect(mockLocale.applied).toBe("he-IL");
    expect(await migrated()).toBe(true);
  });
});

describe("migrateLegacyLanguage with an unreadable per-app locale", () => {
  it("skips the migration for this launch instead of reading the failure as system", async () => {
    mockLocale.available = true;
    mockLocale.readFails = true;
    await expect(migrateLegacyLanguage(input)).rejects.toThrow(
      "native read failed",
    );
    // Nothing was pinned over a choice that could not be read, and the flag is still unset.
    expect(mockLocale.applied).toBe("");
    expect(await migrated()).toBe(false);

    // The next launch, with a readable locale, migrates as usual.
    mockLocale.readFails = false;
    await expect(migrateLegacyLanguage(input)).resolves.toBe("he-IL");
    expect(mockLocale.applied).toBe("he-IL");
    expect(await migrated()).toBe(true);
  });
});

describe("readDeviceLocales", () => {
  it("reads the system list from native, and falls back when that read throws", () => {
    mockLocale.available = true;
    expect(readDeviceLocales()).toEqual(["de-DE"]);
    mockLocale.systemFails = true;
    const fallback = readDeviceLocales();
    expect(Array.isArray(fallback)).toBe(true);
    expect(fallback).not.toContain("de-DE");
  });
});

describe("persistPreference", () => {
  it("clears the Android per-app locale with an empty string for system", async () => {
    mockLocale.available = true;
    mockLocale.applied = "de-DE";
    await persistPreference("system");
    expect(mockLocale.applied).toBe("");
    await persistPreference("he-IL");
    expect(mockLocale.applied).toBe("he-IL");
  });

  it("writes system and tags to sync_meta on web", async () => {
    await persistPreference("he-IL");
    expect(await stored()).toBe("he-IL");
    await persistPreference("system");
    expect(await stored()).toBe("system");
  });
});
