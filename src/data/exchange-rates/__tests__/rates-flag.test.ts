import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, writeMeta } from "@/data/sync-store";
import {
  readRatesFlag,
  writeRatesFlag,
} from "@/data/exchange-rates/rates-flag";

const storage = async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.initialize();
  return adapter;
};

describe("readRatesFlag", () => {
  it("is off by default, with no last-refresh time", async () => {
    const adapter = await storage();
    const flag = await adapter.transact((tx) => readRatesFlag(tx));
    expect(flag).toEqual({ enabled: false, lastRefreshAt: null });
  });

  it('is on only when the stored value is exactly "1"', async () => {
    const adapter = await storage();
    await adapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.ratesAutoFetch]: "true" }),
    );
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      false,
    );

    await adapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.ratesAutoFetch]: "1" }),
    );
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      true,
    );
  });

  it("reads back a stored last-refresh timestamp", async () => {
    const adapter = await storage();
    await adapter.transact((tx) =>
      writeMeta(tx, {
        [SYNC_META.ratesLastRefreshAt]: "2026-09-25T00:00:00.000Z",
      }),
    );
    const flag = await adapter.transact((tx) => readRatesFlag(tx));
    expect(flag.lastRefreshAt).toBe("2026-09-25T00:00:00.000Z");
  });
});

describe("writeRatesFlag", () => {
  it("turns the flag on and off", async () => {
    const adapter = await storage();
    await adapter.transact((tx) => writeRatesFlag(tx, { enabled: true }));
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      true,
    );

    await adapter.transact((tx) => writeRatesFlag(tx, { enabled: false }));
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      false,
    );
  });

  it("writes only the fields present in the patch", async () => {
    const adapter = await storage();
    await adapter.transact((tx) =>
      writeRatesFlag(tx, {
        enabled: true,
        lastRefreshAt: "2026-09-25T00:00:00.000Z",
      }),
    );
    await adapter.transact((tx) => writeRatesFlag(tx, { enabled: false }));

    const flag = await adapter.transact((tx) => readRatesFlag(tx));
    expect(flag).toEqual({
      enabled: false,
      lastRefreshAt: "2026-09-25T00:00:00.000Z",
    });
  });
});
