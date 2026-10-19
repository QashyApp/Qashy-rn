import {
  comparableSnapshot,
  createWidgetRefresher,
  type PlacedWidgetRef,
  type RefresherDeps,
} from "@/features/widgets/refresher-core";
import type { WidgetSnapshot } from "@/features/widgets/snapshot";
import { DEFAULT_WIDGET_SETTINGS } from "@/features/widgets/settings";

const snapshot = (generatedAt: string, marker = "a"): WidgetSnapshot =>
  ({
    version: 1,
    generatedAt,
    hideAmounts: false,
    labels: {},
    widgets: { "1": { marker } },
  }) as unknown as WidgetSnapshot;

function setup(overrides: Partial<RefresherDeps> = {}) {
  let placed: PlacedWidgetRef[] = [{ id: 1, kind: "summary" }];
  let counter = 0;
  let marker = "a";
  const mocks = {
    isAvailable: jest.fn(() => true),
    getPlacedWidgets: jest.fn(async () => placed),
    update: jest.fn(async (_json: string) => undefined),
    clear: jest.fn(async () => undefined),
    pruneSettings: jest.fn(async () => DEFAULT_WIDGET_SETTINGS),
    buildSnapshot: jest.fn(async () => snapshot(`t${(counter += 1)}`, marker)),
    log: jest.fn(),
  };
  const deps: RefresherDeps = { ...mocks, ...overrides };
  return {
    // The default fakes, for assertions; a test that overrides one asserts on its own.
    deps: mocks,
    refresher: createWidgetRefresher(deps),
    place: (next: PlacedWidgetRef[]) => (placed = next),
    setMarker: (next: string) => (marker = next),
  };
}

/** A promise settled by hand, to hold a run open. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

describe("widget refresher", () => {
  it("is a no-op when the native module is unavailable", async () => {
    const { deps, refresher } = setup({ isAvailable: () => false });
    await refresher.refresh();
    await refresher.clearData();
    expect(deps.getPlacedWidgets).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.clear).not.toHaveBeenCalled();
  });

  it("pushes the snapshot JSON once, and skips an unchanged one that differs only in generatedAt", async () => {
    const { deps, refresher } = setup();
    await refresher.refresh();
    await refresher.refresh();
    await refresher.refresh();
    expect(deps.buildSnapshot).toHaveBeenCalledTimes(3);
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(JSON.parse(deps.update.mock.calls[0][0])).toMatchObject({
      version: 1,
      generatedAt: "t1",
    });
  });

  it("pushes again when the content changes", async () => {
    const { deps, refresher, setMarker } = setup();
    await refresher.refresh();
    setMarker("b");
    await refresher.refresh();
    expect(deps.update).toHaveBeenCalledTimes(2);
  });

  it("coalesces calls made during a run into exactly one rerun", async () => {
    const held = gate();
    let first = true;
    const getPlacedWidgets = jest.fn(async (): Promise<PlacedWidgetRef[]> => {
      if (first) {
        first = false;
        await held.promise;
      }
      return [{ id: 1, kind: "summary" }];
    });
    const { deps, refresher } = setup({ getPlacedWidgets });
    const runs = [
      refresher.refresh(),
      refresher.refresh(),
      refresher.refresh(),
    ];
    await Promise.resolve();
    expect(getPlacedWidgets).toHaveBeenCalledTimes(1);
    held.open();
    await Promise.all(runs);
    expect(getPlacedWidgets).toHaveBeenCalledTimes(2);
    expect(deps.buildSnapshot).toHaveBeenCalledTimes(2);
  });

  it("never runs two refreshes at once", async () => {
    let active = 0;
    let peak = 0;
    const { refresher } = setup({
      buildSnapshot: jest.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return snapshot("t");
      }),
    });
    await Promise.all([
      refresher.refresh(),
      refresher.refresh(),
      refresher.refresh(),
    ]);
    expect(peak).toBe(1);
  });

  it("clears once when no widget is placed, then stays quiet", async () => {
    const { deps, refresher, place } = setup();
    place([]);
    await refresher.refresh();
    await refresher.refresh();
    expect(deps.clear).toHaveBeenCalledTimes(1);
    expect(deps.buildSnapshot).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
  });

  it("clears after a push when the last widget is removed, and pushes again when one returns", async () => {
    const { deps, refresher, place } = setup();
    await refresher.refresh();
    place([]);
    await refresher.refresh();
    expect(deps.clear).toHaveBeenCalledTimes(1);
    place([{ id: 2, kind: "transactions" }]);
    await refresher.refresh();
    // The same content as before is still pushed: the clear forgot the last push.
    expect(deps.update).toHaveBeenCalledTimes(2);
  });

  it("prunes with the ids that are placed", async () => {
    const { deps, refresher, place } = setup();
    place([
      { id: 3, kind: "summary" },
      { id: 8, kind: "transactions" },
    ]);
    await refresher.refresh();
    expect(deps.pruneSettings).toHaveBeenCalledWith(new Set(["3", "8"]));
  });

  it("skips the push when the data is not ready", async () => {
    const { deps, refresher } = setup({
      buildSnapshot: jest.fn(async () => null),
    });
    await refresher.refresh();
    expect(deps.update).not.toHaveBeenCalled();
  });

  it("logs a failure without finance data, resolves, and retries on the next call", async () => {
    const failing = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Coffee $4.50 at Bean Co"), {
          name: "BoomError",
        }),
      )
      .mockResolvedValue(snapshot("t"));
    const { deps, refresher } = setup({ buildSnapshot: failing });
    await expect(refresher.refresh()).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("Widget refresh failed", "BoomError");
    expect(JSON.stringify(deps.log.mock.calls)).not.toMatch(/Coffee|4\.50/);
    expect(deps.update).not.toHaveBeenCalled();
    await refresher.refresh();
    expect(deps.update).toHaveBeenCalledTimes(1);
  });

  it("does not remember a push that failed", async () => {
    const update = jest
      .fn()
      .mockRejectedValueOnce(new Error("native"))
      .mockResolvedValue(undefined);
    const { refresher } = setup({ update });
    await refresher.refresh();
    await refresher.refresh();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("clearData clears the native store and then rebuilds and pushes afresh", async () => {
    const order: string[] = [];
    const { deps, refresher } = setup({
      update: jest.fn(async () => void order.push("update")),
      clear: jest.fn(async () => void order.push("clear")),
    });
    await refresher.refresh();
    await refresher.clearData();
    // Same content as before, but the clear forgot the last push.
    expect(order).toEqual(["update", "clear", "update"]);
    expect(deps.buildSnapshot).toHaveBeenCalledTimes(2);
  });

  it("runs the rebuild after the clear even when a refresh is in flight or requested meanwhile", async () => {
    const held = gate();
    const order: string[] = [];
    let first = true;
    const { refresher } = setup({
      buildSnapshot: jest.fn(async () => {
        if (first) {
          first = false;
          await held.promise;
        }
        return snapshot("t");
      }),
      update: jest.fn(async () => void order.push("update")),
      clear: jest.fn(async () => void order.push("clear")),
    });
    const run = refresher.refresh();
    const cleared = refresher.clearData();
    // A debounced refresh landing right after the replace import must not slip in before the clear.
    const late = refresher.refresh();
    await Promise.resolve();
    held.open();
    await Promise.all([run, cleared, late]);
    expect(order).toEqual(["update", "clear", "update"]);
  });

  it("clearData logs a native clear failure, still rebuilds, and resolves", async () => {
    const { deps, refresher } = setup({
      clear: jest.fn(async () => {
        throw new Error("native");
      }),
    });
    await expect(refresher.clearData()).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith("Widget clear failed", "Error");
    expect(deps.update).toHaveBeenCalledTimes(1);
  });
});

describe("comparableSnapshot", () => {
  it("ignores generatedAt only", () => {
    expect(comparableSnapshot(snapshot("a"))).toBe(
      comparableSnapshot(snapshot("b")),
    );
    expect(comparableSnapshot(snapshot("a", "x"))).not.toBe(
      comparableSnapshot(snapshot("a", "y")),
    );
  });
});
