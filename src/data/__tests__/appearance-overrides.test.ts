import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import { initialSettings } from "@/domain/defaults";
import type { AppSettings } from "@/domain/models";
import { diffEntity, hlcFromTimestamp } from "@/sync/oplog";
import { specFor } from "@/sync/oplog/registry";

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

const KEYS = [
  "fontTextOverride",
  "fontNumericOverride",
  "uiIconSetOverride",
  "categoryIconSetOverride",
] as const;

describe("appearance overrides", () => {
  it("default to following the theme", async () => {
    for (const key of KEYS) expect(initialSettings()[key]).toBeNull();
    const settings = (await createRepository()).getSnapshot().settings;
    for (const key of KEYS) expect(settings[key]).toBeNull();
  });

  it("set, keep when omitted, and clear with null", async () => {
    const repository = await createRepository();
    await repository.updateSettings({
      fontTextOverride: "inter",
      uiIconSetOverride: "material",
    });
    await repository.updateSettings({ fontNumericOverride: "nunito" });
    let settings = repository.getSnapshot().settings;
    expect(settings.fontTextOverride).toBe("inter");
    expect(settings.fontNumericOverride).toBe("nunito");
    expect(settings.uiIconSetOverride).toBe("material");
    expect(settings.categoryIconSetOverride).toBeNull();
    await repository.updateSettings({ fontTextOverride: null });
    settings = repository.getSnapshot().settings;
    expect(settings.fontTextOverride).toBeNull();
    expect(settings.fontNumericOverride).toBe("nunito");
  });

  it("accepts an id nothing resolves (it falls back at render time) but rejects junk", async () => {
    const repository = await createRepository();
    await repository.updateSettings({ fontTextOverride: "future-font" });
    expect(repository.getSnapshot().settings.fontTextOverride).toBe(
      "future-font",
    );
    await expect(
      repository.updateSettings({ fontTextOverride: "Not Valid!" }),
    ).rejects.toThrow("appearance override");
    expect(repository.getSnapshot().settings.fontTextOverride).toBe(
      "future-font",
    );
  });

  it("are device-local, so a change never becomes an outgoing sync op", async () => {
    const repository = await createRepository();
    const before = repository.getSnapshot().settings;
    for (const key of KEYS) {
      expect(specFor("settings")[key]).toEqual({ kind: "deviceLocal" });
      const after: AppSettings = { ...before, [key]: "inter" };
      const { ops } = diffEntity(
        "settings",
        before,
        after,
        hlcFromTimestamp("2026-01-01T00:00:00.000Z", 0, "A".repeat(26)),
      );
      expect(ops).toEqual([]);
    }
  });
});
