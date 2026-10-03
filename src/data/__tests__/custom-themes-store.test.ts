import {
  CustomThemeStoreError,
  MAX_CUSTOM_THEMES,
  MAX_CUSTOM_THEMES_BYTES,
  deleteCustomThemeFile,
  loadCustomThemeFiles,
  saveCustomThemeFile,
} from "@/data/custom-themes-store";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, writeMeta } from "@/data/sync-store";
import { SyncingStorageAdapter } from "@/data/syncing-storage-adapter";
import { initialSettings } from "@/domain/defaults";
import { FULL_EXAMPLE, MINIMAL_EXAMPLE } from "@/theme/custom/examples";
import type { CustomThemeFile } from "@/theme/custom/schema";

const memory = async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.initialize();
  return adapter;
};

const withId = (id: string): CustomThemeFile => ({
  ...MINIMAL_EXAMPLE,
  id,
  name: id,
});
const rawMeta = (adapter: MemoryStorageAdapter) =>
  adapter.transact((tx) => tx.table("syncMeta").get(SYNC_META.customThemes));
const writeRaw = (adapter: MemoryStorageAdapter, value: string) =>
  adapter.transact((tx) => writeMeta(tx, { [SYNC_META.customThemes]: value }));

describe("custom themes store", () => {
  it("reads no themes when nothing has been written", async () => {
    expect(await loadCustomThemeFiles(await memory())).toEqual([]);
  });

  it("round-trips saved files and stores only the file JSON", async () => {
    const adapter = await memory();
    await adapter.transact((tx) => saveCustomThemeFile(tx, MINIMAL_EXAMPLE));
    await adapter.transact((tx) => saveCustomThemeFile(tx, FULL_EXAMPLE));
    expect(await loadCustomThemeFiles(adapter)).toEqual([
      MINIMAL_EXAMPLE,
      FULL_EXAMPLE,
    ]);
    const stored = (await rawMeta(adapter))?.value ?? "";
    expect(stored).not.toContain("shadowCard");
    expect(stored).not.toContain('"shadows"');
  });

  it("replaces by id rather than duplicating", async () => {
    const adapter = await memory();
    await adapter.transact((tx) => saveCustomThemeFile(tx, MINIMAL_EXAMPLE));
    await adapter.transact((tx) =>
      saveCustomThemeFile(tx, { ...MINIMAL_EXAMPLE, name: "Renamed" }),
    );
    const files = await loadCustomThemeFiles(adapter);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Renamed");
  });

  it("deletes by id and ignores unknown ids", async () => {
    const adapter = await memory();
    await adapter.transact((tx) => saveCustomThemeFile(tx, withId("one")));
    await adapter.transact((tx) => saveCustomThemeFile(tx, withId("two")));
    await adapter.transact((tx) => deleteCustomThemeFile(tx, "one"));
    await adapter.transact((tx) => deleteCustomThemeFile(tx, "missing"));
    expect(
      (await loadCustomThemeFiles(adapter)).map((file) => file.id),
    ).toEqual(["two"]);
  });

  it("degrades to no themes on corrupt or wrongly shaped data", async () => {
    const adapter = await memory();
    for (const raw of [
      "{not json",
      "null",
      "[]",
      '"x"',
      '{"themes":"nope"}',
      '{"themes":[null,5,"x"]}',
    ]) {
      await writeRaw(adapter, raw);
      expect(await loadCustomThemeFiles(adapter)).toEqual([]);
    }
  });

  it("degrades to no themes when the stored document is oversized", async () => {
    const adapter = await memory();
    await writeRaw(
      adapter,
      `{"themes":[],"pad":"${"x".repeat(MAX_CUSTOM_THEMES_BYTES)}"}`,
    );
    expect(await loadCustomThemeFiles(adapter)).toEqual([]);
  });

  it("drops an entry that no longer parses instead of throwing", async () => {
    const adapter = await memory();
    const broken = {
      ...MINIMAL_EXAMPLE,
      id: "broken",
      icons: { set: "removed-set" },
    };
    const duplicate = { ...MINIMAL_EXAMPLE, name: "Dup" };
    await writeRaw(
      adapter,
      JSON.stringify({
        version: 1,
        themes: [broken, FULL_EXAMPLE, MINIMAL_EXAMPLE, duplicate],
      }),
    );
    expect(
      (await loadCustomThemeFiles(adapter)).map((file) => file.id),
    ).toEqual(["moss-block", "forest-minimal"]);
  });

  it("caps the list at eight themes on read and refuses a ninth on write", async () => {
    const adapter = await memory();
    for (let index = 0; index < MAX_CUSTOM_THEMES; index += 1) {
      await adapter.transact((tx) =>
        saveCustomThemeFile(tx, withId(`theme-${index}`)),
      );
    }
    await expect(
      adapter.transact((tx) => saveCustomThemeFile(tx, withId("theme-extra"))),
    ).rejects.toMatchObject({ code: "limit" });
    // Replacing at the cap is still allowed.
    await adapter.transact((tx) => saveCustomThemeFile(tx, withId("theme-3")));
    expect(await loadCustomThemeFiles(adapter)).toHaveLength(MAX_CUSTOM_THEMES);

    const many = Array.from({ length: 12 }, (_, index) =>
      withId(`over-${index}`),
    );
    await writeRaw(adapter, JSON.stringify({ version: 1, themes: many }));
    expect(await loadCustomThemeFiles(adapter)).toHaveLength(MAX_CUSTOM_THEMES);
  });

  it("refuses to persist an invalid file", async () => {
    const adapter = await memory();
    const bad = {
      ...MINIMAL_EXAMPLE,
      extra: true,
    } as unknown as CustomThemeFile;
    await expect(
      adapter.transact((tx) => saveCustomThemeFile(tx, bad)),
    ).rejects.toBeInstanceOf(CustomThemeStoreError);
    expect(await rawMeta(adapter)).toBeUndefined();
  });
});

describe("custom themes stay on this device", () => {
  it("writes through transact: no sync op, no record, no peer or state row", async () => {
    const inner = await memory();
    const syncing = new SyncingStorageAdapter(inner, "device-a", () =>
      Date.parse("2026-06-01T12:00:00.000Z"),
    );
    await syncing.transact((tx) => saveCustomThemeFile(tx, FULL_EXAMPLE));
    await syncing.transact((tx) => deleteCustomThemeFile(tx, "missing"));

    const counts = await syncing.transact(async (tx) => ({
      ops: (await tx.table("syncOps").all()).length,
      state: (await tx.table("syncState").all()).length,
      peers: (await tx.table("syncPeers").all()).length,
      settings: (await tx.readAll("settings")).length,
    }));
    expect(counts).toEqual({ ops: 0, state: 0, peers: 0, settings: 0 });
    expect(await loadCustomThemeFiles(syncing)).toEqual([FULL_EXAMPLE]);
  });

  it("is not a field of AppSettings, which replicates", () => {
    expect(Object.keys(initialSettings()).join(" ")).not.toMatch(/custom/i);
    expect(JSON.stringify(initialSettings())).not.toContain(
      "themeSchemaVersion",
    );
  });
});
