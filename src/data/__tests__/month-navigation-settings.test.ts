import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, readMeta } from "@/data/sync-store";
import { initialSettings } from "@/domain/defaults";
import type { AppSettings } from "@/domain/models";
import { diffEntity, hlcFromTimestamp } from "@/sync/oplog";
import { specFor } from "@/sync/oplog/registry";

const ONBOARDING = {
  locale: "en-US",
  baseCurrency: "USD",
  accountName: "Everyday",
  accountType: "checking",
  openingBalanceMinor: 0,
  themeMode: "system",
  accentSource: "system",
  accentHex: "#5966E9",
} as const;

async function createRepository(storage = new MemoryStorageAdapter()) {
  const repository = new LocalFinanceRepository(storage);
  await repository.initialize();
  await repository.completeOnboarding(ONBOARDING);
  return { repository, storage };
}

/** An install from before swiping defaulted to on: swiping stored off, no migration flag. */
async function createLegacyStorage() {
  const { repository, storage } = await createRepository();
  await repository.updateSettings({ swipeBetweenMonths: false });
  await storage.transact((tx) =>
    tx.table("syncMeta").delete([SYNC_META.swipeDefaultMigrated]),
  );
  return storage;
}

async function migrated(storage: MemoryStorageAdapter) {
  const meta = await storage.transact((tx) =>
    readMeta(tx, [SYNC_META.swipeDefaultMigrated]),
  );
  return meta.get(SYNC_META.swipeDefaultMigrated) === "1";
}

describe("swipeBetweenMonths default and one-time migration", () => {
  it("defaults to on for a fresh install and leaves the flag marked", async () => {
    expect(initialSettings().swipeBetweenMonths).toBe(true);
    const { repository, storage } = await createRepository();
    expect(repository.getSnapshot().settings.swipeBetweenMonths).toBe(true);
    expect(await migrated(storage)).toBe(true);
  });

  it("turns an existing off into on once, notifying subscribers", async () => {
    const storage = await createLegacyStorage();
    const reloaded = new LocalFinanceRepository(storage);
    const listener = jest.fn();
    reloaded.subscribe(listener);
    await reloaded.initialize();
    expect(reloaded.getSnapshot().settings.swipeBetweenMonths).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(await migrated(storage)).toBe(true);

    // Persisted, not just in memory.
    const again = new LocalFinanceRepository(storage);
    await again.initialize();
    expect(again.getSnapshot().settings.swipeBetweenMonths).toBe(true);
  });

  it("does not run again once the user has turned swiping off", async () => {
    const storage = await createLegacyStorage();
    const first = new LocalFinanceRepository(storage);
    await first.initialize();
    await first.updateSettings({ swipeBetweenMonths: false });

    const second = new LocalFinanceRepository(storage);
    await second.initialize();
    await second.sweepArchived();
    expect(second.getSnapshot().settings.swipeBetweenMonths).toBe(false);
  });

  it("does not run on the write-free headless path, only on the foreground step", async () => {
    const storage = await createLegacyStorage();
    const headless = new LocalFinanceRepository(storage);
    await headless.initialize({ generateRecurring: false });
    expect(headless.getSnapshot().settings.swipeBetweenMonths).toBe(false);
    expect(await migrated(storage)).toBe(false);

    // The foreground then runs `sweepArchived()` after the memoized headless initialize.
    await headless.sweepArchived();
    expect(headless.getSnapshot().settings.swipeBetweenMonths).toBe(true);
    expect(await migrated(storage)).toBe(true);
  });

  it("marks the flag only after the write succeeds, and retries next launch", async () => {
    const storage = await createLegacyStorage();
    const failing = new LocalFinanceRepository(storage);
    const putMany = jest
      .spyOn(storage, "putMany")
      .mockRejectedValueOnce(new Error("disk full"));
    await failing.initialize();
    putMany.mockRestore();
    expect(failing.getSnapshot().settings.swipeBetweenMonths).toBe(false);
    expect(await migrated(storage)).toBe(false);

    const retry = new LocalFinanceRepository(storage);
    await retry.initialize();
    expect(retry.getSnapshot().settings.swipeBetweenMonths).toBe(true);
    expect(await migrated(storage)).toBe(true);
  });
});

describe("monthSlideStyle setting", () => {
  it("defaults to cascade", async () => {
    expect(initialSettings().monthSlideStyle).toBe("cascade");
    const { repository } = await createRepository();
    expect(repository.getSnapshot().settings.monthSlideStyle).toBe("cascade");
  });

  it("applies immediately and rejects values it does not know", async () => {
    const { repository } = await createRepository();
    const updated = await repository.updateSettings({
      monthSlideStyle: "deck",
    });
    expect(updated.monthSlideStyle).toBe("deck");
    await expect(
      repository.updateSettings({
        monthSlideStyle: "spin" as unknown as "deck",
      }),
    ).rejects.toThrow("month slide style");
    expect(repository.getSnapshot().settings.monthSlideStyle).toBe("deck");
  });

  it("reads a row saved before it existed as cascade", async () => {
    const { storage } = await createRepository();
    const [row] = await storage.readAll("settings");
    const { monthSlideStyle: _omitted, ...legacy } = row as AppSettings;
    await storage.putMany([{ type: "settings", entity: legacy }]);
    const reloaded = new LocalFinanceRepository(storage);
    await reloaded.initialize();
    expect(reloaded.getSnapshot().settings.monthSlideStyle).toBe("cascade");
  });

  it("is device-local, so a change never becomes an outgoing sync op", async () => {
    expect(specFor("settings").monthSlideStyle).toEqual({
      kind: "deviceLocal",
    });
    const { repository } = await createRepository();
    const before = repository.getSnapshot().settings;
    const after: AppSettings = { ...before, monthSlideStyle: "calm" };
    const { ops } = diffEntity(
      "settings",
      before,
      after,
      hlcFromTimestamp("2026-01-01T00:00:00.000Z", 0, "A".repeat(26)),
    );
    expect(ops).toEqual([]);
  });
});
