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

describe("hapticsEnabled setting", () => {
  it("defaults to on", async () => {
    expect(initialSettings().hapticsEnabled).toBe(true);
    const repository = await createRepository();
    expect(repository.getSnapshot().settings.hapticsEnabled).toBe(true);
  });

  it("turns off and back on, and other updates leave it alone", async () => {
    const repository = await createRepository();
    const off = await repository.updateSettings({ hapticsEnabled: false });
    expect(off.hapticsEnabled).toBe(false);
    const other = await repository.updateSettings({ swipeBetweenMonths: true });
    expect(other.hapticsEnabled).toBe(false);
    const on = await repository.updateSettings({ hapticsEnabled: true });
    expect(on.hapticsEnabled).toBe(true);
  });

  it("is device-local, so a change never becomes an outgoing sync op", async () => {
    expect(specFor("settings").hapticsEnabled).toEqual({ kind: "deviceLocal" });
    const repository = await createRepository();
    const before = repository.getSnapshot().settings;
    const after: AppSettings = { ...before, hapticsEnabled: false };
    const { ops } = diffEntity(
      "settings",
      before,
      after,
      hlcFromTimestamp("2026-01-01T00:00:00.000Z", 0, "A".repeat(26)),
    );
    expect(ops).toEqual([]);
  });
});
