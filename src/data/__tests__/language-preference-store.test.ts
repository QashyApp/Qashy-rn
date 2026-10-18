import {
  readLanguageMigrated,
  readLanguagePreference,
  writeLanguageMigrated,
  writeLanguagePreference,
} from "@/data/language-preference-store";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, writeMeta } from "@/data/sync-store";

const storage = async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.initialize();
  return adapter;
};

describe("language preference store", () => {
  it("defaults to system", async () => {
    const adapter = await storage();
    expect(await adapter.transact((tx) => readLanguagePreference(tx))).toBe(
      "system",
    );
  });

  it("reads back what was written", async () => {
    const adapter = await storage();
    await adapter.transact((tx) => writeLanguagePreference(tx, "he-IL"));
    expect(await adapter.transact((tx) => readLanguagePreference(tx))).toBe(
      "he-IL",
    );
    await adapter.transact((tx) => writeLanguagePreference(tx, "system"));
    expect(await adapter.transact((tx) => readLanguagePreference(tx))).toBe(
      "system",
    );
  });

  it("reads a blank stored value as system", async () => {
    const adapter = await storage();
    await adapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.appLanguage]: "  " }),
    );
    expect(await adapter.transact((tx) => readLanguagePreference(tx))).toBe(
      "system",
    );
  });

  it("records the migration flag only as exactly 1", async () => {
    const adapter = await storage();
    expect(await adapter.transact((tx) => readLanguageMigrated(tx))).toBe(
      false,
    );
    await adapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.languageMigrated]: "true" }),
    );
    expect(await adapter.transact((tx) => readLanguageMigrated(tx))).toBe(
      false,
    );
    await adapter.transact((tx) => writeLanguageMigrated(tx));
    expect(await adapter.transact((tx) => readLanguageMigrated(tx))).toBe(true);
  });
});
