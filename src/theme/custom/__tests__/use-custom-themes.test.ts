import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, writeMeta } from "@/data/sync-store";
import { SyncingStorageAdapter } from "@/data/syncing-storage-adapter";
import { FULL_EXAMPLE, MINIMAL_EXAMPLE } from "@/theme/custom/examples";
import type { CustomThemeFile } from "@/theme/custom/schema";
import { createCustomThemesStore } from "@/theme/custom/use-custom-themes";

// The module also builds the app singleton over the real storage; these tests inject their own.
jest.mock("@/data/local-finance-repository", () => ({ syncingStorage: {} }));

const memory = async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.initialize();
  return adapter;
};
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("custom themes store", () => {
  it("starts loading with no themes, then loads parsed definitions", async () => {
    const adapter = await memory();
    const first = createCustomThemesStore({ storage: adapter });
    expect(first.getSnapshot()).toMatchObject({
      status: "loading",
      themes: [],
      files: [],
    });
    first.load();
    await settled();
    expect(first.getSnapshot().status).toBe("ready");

    await first.save(FULL_EXAMPLE);
    const second = createCustomThemesStore({ storage: adapter });
    second.load();
    await settled();
    expect(second.getSnapshot().files).toEqual([FULL_EXAMPLE]);
    expect(second.getSnapshot().themes.map((theme) => theme.id)).toEqual([
      FULL_EXAMPLE.id,
    ]);
  });

  it("drops a stored theme that no longer parses", async () => {
    const adapter = await memory();
    const broken = {
      ...MINIMAL_EXAMPLE,
      id: "broken",
      icons: { set: "removed-set" },
    };
    await adapter.transact((tx) =>
      writeMeta(tx, {
        [SYNC_META.customThemes]: JSON.stringify({
          version: 1,
          themes: [broken, MINIMAL_EXAMPLE],
        }),
      }),
    );
    const store = createCustomThemesStore({ storage: adapter });
    store.load();
    await settled();
    expect(store.getSnapshot().themes.map((theme) => theme.id)).toEqual([
      MINIMAL_EXAMPLE.id,
    ]);
  });

  it("settles to ready with no themes when storage fails", async () => {
    const failing = {
      transact: () => Promise.reject(new Error("boom")),
    } as unknown as MemoryStorageAdapter;
    const store = createCustomThemesStore({ storage: failing });
    store.load();
    await settled();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", themes: [] });
  });

  it("save and remove update state and notify subscribers", async () => {
    const store = createCustomThemesStore({ storage: await memory() });
    const listener = jest.fn();
    store.subscribe(listener);
    await store.save(MINIMAL_EXAMPLE);
    expect(store.getSnapshot().themes).toHaveLength(1);
    await store.save({ ...MINIMAL_EXAMPLE, name: "Renamed" });
    expect(store.getSnapshot().files).toHaveLength(1);
    expect(store.getSnapshot().files[0].name).toBe("Renamed");
    await store.remove(MINIMAL_EXAMPLE.id);
    expect(store.getSnapshot().themes).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid file and keeps the snapshot unchanged", async () => {
    const store = createCustomThemesStore({ storage: await memory() });
    await store.save(MINIMAL_EXAMPLE);
    const before = store.getSnapshot();
    const bad = {
      ...MINIMAL_EXAMPLE,
      id: "bad",
      extra: 1,
    } as unknown as CustomThemeFile;
    await expect(store.save(bad)).rejects.toMatchObject({ code: "invalid" });
    expect(store.getSnapshot()).toBe(before);
  });

  it("refuses a ninth theme with the limit error", async () => {
    const store = createCustomThemesStore({ storage: await memory() });
    for (let index = 0; index < 8; index += 1)
      await store.save({
        ...MINIMAL_EXAMPLE,
        id: `theme-${index}`,
        name: `T${index}`,
      });
    await expect(
      store.save({ ...MINIMAL_EXAMPLE, id: "one-too-many" }),
    ).rejects.toMatchObject({ code: "limit" });
    expect(store.getSnapshot().files).toHaveLength(8);
  });

  it("captures no sync op, record, peer or state row", async () => {
    const inner = await memory();
    const syncing = new SyncingStorageAdapter(inner, "device-a", () =>
      Date.parse("2026-06-01T12:00:00.000Z"),
    );
    const store = createCustomThemesStore({ storage: syncing });
    await store.save(FULL_EXAMPLE);
    await store.remove(FULL_EXAMPLE.id);
    await store.save(MINIMAL_EXAMPLE);
    const counts = await syncing.transact(async (tx) => ({
      ops: (await tx.table("syncOps").all()).length,
      state: (await tx.table("syncState").all()).length,
      peers: (await tx.table("syncPeers").all()).length,
      settings: (await tx.readAll("settings")).length,
    }));
    expect(counts).toEqual({ ops: 0, state: 0, peers: 0, settings: 0 });
  });
});
