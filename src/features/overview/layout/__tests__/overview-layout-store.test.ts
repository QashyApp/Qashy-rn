import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { StorageAdapter } from "@/data/storage-adapter";
import { DEFAULT_OVERVIEW_LAYOUT } from "@/domain/overview-layout";
import { createOverviewLayoutStore } from "@/features/overview/layout/use-overview-layout";

const ids = (store: ReturnType<typeof createOverviewLayoutStore>) =>
  store.getSnapshot().layout.cards.map((card) => card.id);

const [A, B, C, D, E] = DEFAULT_OVERVIEW_LAYOUT.cards.map((card) => card.id);

/**
 * A memory adapter whose writes can be told to fail: `failAt` lists the 1-based write numbers
 * (the initial read is not counted) that reject.
 */
function flakyStorage() {
  const inner = new MemoryStorageAdapter();
  const control = { failAt: new Set<number>(), writes: 0 };
  let reads = 0;
  const storage: StorageAdapter = Object.assign(Object.create(inner), {
    transact: async (...args: Parameters<StorageAdapter["transact"]>) => {
      if (reads === 0) {
        reads += 1;
        return inner.transact(...args);
      }
      control.writes += 1;
      if (control.failAt.has(control.writes)) throw new Error("disk full");
      return inner.transact(...args);
    },
  });
  return { storage, control, inner };
}

async function readyStore(...failAt: number[]) {
  const flaky = flakyStorage();
  const store = createOverviewLayoutStore({ storage: flaky.storage });
  store.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.getSnapshot().status).toBe("ready");
  for (const write of failAt) flaky.control.failAt.add(write);
  return { store, ...flaky };
}

describe("overview layout store: overlapping writes", () => {
  it("applies two quick dispatches in call order", async () => {
    const { store } = await readyStore();
    await Promise.all([
      store.dispatch({ type: "move", id: E, toIndex: 0 }),
      store.dispatch({ type: "move", id: D, toIndex: 0 }),
    ]);
    expect(ids(store)).toEqual([D, E, A, B, C]);
  });

  it("reverts to the committed layout when a lone write fails", async () => {
    const { store } = await readyStore(1);
    await expect(
      store.dispatch({ type: "move", id: E, toIndex: 0 }),
    ).rejects.toThrow("disk full");
    expect(ids(store)).toEqual([A, B, C, D, E]);
    // The next save starts from what is on screen, not from the failed order.
    await store.dispatch({ type: "move", id: B, toIndex: 4 });
    expect(ids(store)).toEqual([A, C, D, E, B]);
  });

  it("replays the second drop on the committed layout when the first fails", async () => {
    const { store } = await readyStore(1);
    const first = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const second = store.dispatch({ type: "move", id: D, toIndex: 0 });
    await expect(first).rejects.toThrow("disk full");
    await expect(second).resolves.toBeUndefined();
    // Only the second drop landed; the failed first one is not smuggled in with it.
    expect(ids(store)).toEqual([D, A, B, C, E]);
  });

  it("keeps the first drop when only the second fails", async () => {
    const { store } = await readyStore(2);
    const first = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const second = store.dispatch({ type: "move", id: D, toIndex: 0 });
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow("disk full");
    expect(ids(store)).toEqual([E, A, B, C, D]);
  });

  it("does not persist an order nobody saw after both drops fail", async () => {
    const { store, inner } = await readyStore(1, 2);
    const first = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const second = store.dispatch({ type: "move", id: D, toIndex: 0 });
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(ids(store)).toEqual([A, B, C, D, E]);

    // A later, unrelated save is reduced from the original layout.
    await store.dispatch({ type: "move", id: B, toIndex: 4 });
    expect(ids(store)).toEqual([A, C, D, E, B]);

    // And that is what reached storage.
    const reloaded = createOverviewLayoutStore({ storage: inner });
    reloaded.load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ids(reloaded)).toEqual([A, C, D, E, B]);
  });

  it("resolves a no-op dispatch without writing", async () => {
    const { store, control } = await readyStore();
    await store.dispatch({ type: "move", id: A, toIndex: 0 });
    expect(control.writes).toBe(0);
  });
});
