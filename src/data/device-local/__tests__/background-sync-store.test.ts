import {
  readBackgroundSync,
  subscribeBackgroundSync,
  writeBackgroundSync,
} from "@/data/device-local/background-sync-store";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, writeMeta } from "@/data/sync-store";
import { initialSettings } from "@/domain/defaults";

// The store reads and writes through the app's one syncing storage; point it at memory.
const mockAdapter = new MemoryStorageAdapter();
jest.mock("@/data/local-finance-repository", () => ({
  get syncingStorage() {
    return mockAdapter;
  },
}));

const rawValue = () =>
  mockAdapter.transact((tx) =>
    tx.table("syncMeta").get(SYNC_META.backgroundSync),
  );

beforeAll(() => mockAdapter.initialize());

describe("background sync setting store", () => {
  it("is off by default", async () => {
    expect(await readBackgroundSync()).toBe(false);
    expect(await rawValue()).toBeUndefined();
  });

  it("round-trips and notifies listeners only after the write committed", async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeBackgroundSync(() => seen.push(true));
    const pending = writeBackgroundSync(true);
    expect(seen).toEqual([]);
    await pending;
    expect(seen).toEqual([true]);
    expect(await readBackgroundSync()).toBe(true);
    unsubscribe();
    await writeBackgroundSync(false);
    expect(seen).toEqual([true]);
    expect(await readBackgroundSync()).toBe(false);
  });

  it("treats anything but the exact value 1 as off", async () => {
    await mockAdapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.backgroundSync]: "true" }),
    );
    expect(await readBackgroundSync()).toBe(false);
  });

  it("is device-local: it lives in sync_meta, never in the replicated settings", async () => {
    await writeBackgroundSync(true);
    expect((await rawValue())?.value).toBe("1");
    // `AppSettings` has no field for it, so nothing can replicate it to a peer.
    expect(Object.keys(initialSettings()).join(" ")).not.toMatch(/background/i);
    // Written through `transact`: no op was captured for it.
    const ops = await mockAdapter.transact((tx) => tx.table("syncOps").all());
    expect(ops).toEqual([]);
  });
});
