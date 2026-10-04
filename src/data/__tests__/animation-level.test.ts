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

describe("animationLevel setting", () => {
  it("defaults to full animation", async () => {
    expect(initialSettings().animationLevel).toBe("all");
    const repository = await createRepository();
    expect(repository.getSnapshot().settings.animationLevel).toBe("all");
  });

  it("applies immediately and rejects values it does not know", async () => {
    const repository = await createRepository();
    const updated = await repository.updateSettings({
      animationLevel: "minimal",
    });
    expect(updated.animationLevel).toBe("minimal");
    await expect(
      repository.updateSettings({
        animationLevel: "wild" as unknown as "all",
      }),
    ).rejects.toThrow("animation level");
    expect(repository.getSnapshot().settings.animationLevel).toBe("minimal");
  });

  it("is device-local, so a change never becomes an outgoing sync op", async () => {
    expect(specFor("settings").animationLevel).toEqual({ kind: "deviceLocal" });
    const repository = await createRepository();
    const before = repository.getSnapshot().settings;
    const after: AppSettings = { ...before, animationLevel: "off" };
    const { ops } = diffEntity(
      "settings",
      before,
      after,
      hlcFromTimestamp("2026-01-01T00:00:00.000Z", 0, "A".repeat(26)),
    );
    expect(ops).toEqual([]);
  });
});
