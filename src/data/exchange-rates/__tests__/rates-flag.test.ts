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
  it("is on by default", async () => {
    const adapter = await storage();
    const flag = await adapter.transact((tx) => readRatesFlag(tx));
    expect(flag).toEqual({ enabled: true });
  });

  it('is off only when the stored value is exactly "0"', async () => {
    const adapter = await storage();
    await adapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.ratesAutoFetch]: "false" }),
    );
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      true,
    );

    await adapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.ratesAutoFetch]: "0" }),
    );
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      false,
    );
  });
});

describe("writeRatesFlag", () => {
  it("turns the flag on and off", async () => {
    const adapter = await storage();
    await adapter.transact((tx) => writeRatesFlag(tx, { enabled: false }));
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      false,
    );

    await adapter.transact((tx) => writeRatesFlag(tx, { enabled: true }));
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      true,
    );
  });

  it("leaves the flag alone when the patch is empty", async () => {
    const adapter = await storage();
    await adapter.transact((tx) => writeRatesFlag(tx, { enabled: false }));
    await adapter.transact((tx) => writeRatesFlag(tx, {}));
    expect((await adapter.transact((tx) => readRatesFlag(tx))).enabled).toBe(
      false,
    );
  });
});
