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

describe("navBarStyle setting", () => {
  it("defaults to the native bar", async () => {
    expect(initialSettings().navBarStyle).toBe("native");
    const repository = await createRepository();
    expect(repository.getSnapshot().settings.navBarStyle).toBe("native");
  });

  it("applies immediately and rejects values it does not know", async () => {
    const repository = await createRepository();
    const updated = await repository.updateSettings({
      navBarStyle: "floating",
    });
    expect(updated.navBarStyle).toBe("floating");
    expect(repository.getSnapshot().settings.navBarStyle).toBe("floating");
    await expect(
      repository.updateSettings({
        navBarStyle: "sideways" as unknown as "native",
      }),
    ).rejects.toThrow("navigation bar style");
    expect(repository.getSnapshot().settings.navBarStyle).toBe("floating");
  });

  it("is device-local, so a change never becomes an outgoing sync op", async () => {
    expect(specFor("settings").navBarStyle).toEqual({ kind: "deviceLocal" });
    const repository = await createRepository();
    const before = repository.getSnapshot().settings;
    const after: AppSettings = { ...before, navBarStyle: "floating" };
    const { ops } = diffEntity(
      "settings",
      before,
      after,
      hlcFromTimestamp("2026-01-01T00:00:00.000Z", 0, "A".repeat(26)),
    );
    expect(ops).toEqual([]);
  });
});
