import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, writeMeta } from "@/data/sync-store";
import {
  readWidgetSettings,
  subscribeWidgetSettings,
  updateWidgetSettings,
  writeWidgetSettings,
} from "@/data/widget-settings-store";
import { defaultWidgetConfig } from "@/features/widgets/settings";

// The store reads and writes through the app's one syncing storage; point it at memory.
const mockAdapter = new MemoryStorageAdapter();
jest.mock("@/data/local-finance-repository", () => ({
  get syncingStorage() {
    return mockAdapter;
  },
}));

const rawValue = () =>
  mockAdapter.transact((tx) =>
    tx.table("syncMeta").get(SYNC_META.widgetSettings),
  );

beforeAll(() => mockAdapter.initialize());

describe("widget settings store", () => {
  it("reads defaults before anything is written", async () => {
    expect(await readWidgetSettings()).toEqual({
      hideAmounts: false,
      widgets: {},
    });
  });

  it("round-trips a write and notifies listeners only afterwards", async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeWidgetSettings(() => seen.push(true));
    const next = {
      hideAmounts: true,
      widgets: {
        "5": { ...defaultWidgetConfig("quickAdd"), showSpent: false },
      },
    };
    const pending = writeWidgetSettings(next);
    expect(seen).toEqual([]);
    await pending;
    expect(seen).toEqual([true]);
    expect(await readWidgetSettings()).toEqual(next);
    unsubscribe();
    await writeWidgetSettings({ hideAmounts: false, widgets: {} });
    expect(seen).toEqual([true]);
  });

  it("stores only validated settings", async () => {
    await writeWidgetSettings({
      hideAmounts: false,
      widgets: {
        "6": { ...defaultWidgetConfig("quickAdd"), opacity: 900 },
      },
    });
    expect(JSON.parse((await rawValue())!.value).widgets["6"].opacity).toBe(
      100,
    );
  });

  it("reads defaults from a corrupt stored value", async () => {
    await mockAdapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.widgetSettings]: "{not json" }),
    );
    expect(await readWidgetSettings()).toEqual({
      hideAmounts: false,
      widgets: {},
    });
  });

  it("runs concurrent read-modify-writes one after another without losing any", async () => {
    await writeWidgetSettings({ hideAmounts: false, widgets: {} });
    const add = (id: string) =>
      updateWidgetSettings((current) => ({
        ...current,
        widgets: { ...current.widgets, [id]: defaultWidgetConfig("quickAdd") },
      }));
    await Promise.all(["1", "2", "3", "4", "5"].map(add));
    expect(Object.keys((await readWidgetSettings()).widgets).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("keeps plain writes in call order", async () => {
    await Promise.all([
      writeWidgetSettings({ hideAmounts: true, widgets: {} }),
      writeWidgetSettings({ hideAmounts: false, widgets: {} }),
      writeWidgetSettings({ hideAmounts: true, widgets: {} }),
    ]);
    expect((await readWidgetSettings()).hideAmounts).toBe(true);
  });

  it("writes and notifies nothing when an update returns null", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeWidgetSettings(listener);
    const before = await readWidgetSettings();
    expect(await updateWidgetSettings(() => null)).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("lets one throwing listener not stop the rest, and a failed write notify nobody", async () => {
    const good = jest.fn();
    const offBad = subscribeWidgetSettings(() => {
      throw new Error("listener");
    });
    const offGood = subscribeWidgetSettings(good);
    await writeWidgetSettings({ hideAmounts: false, widgets: {} });
    expect(good).toHaveBeenCalledTimes(1);

    good.mockClear();
    const spy = jest
      .spyOn(mockAdapter, "transact")
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(
      writeWidgetSettings({ hideAmounts: true, widgets: {} }),
    ).rejects.toThrow("disk full");
    spy.mockRestore();
    expect(good).not.toHaveBeenCalled();
    // The queue survives a failed write.
    await writeWidgetSettings({ hideAmounts: true, widgets: {} });
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
