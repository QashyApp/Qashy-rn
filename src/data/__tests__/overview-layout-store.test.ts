import { MemoryStorageAdapter } from "@/data/memory-storage";
import {
  readOverviewLayout,
  writeOverviewLayout,
} from "@/data/overview-layout-store";
import { SYNC_META, writeMeta } from "@/data/sync-store";
import {
  DEFAULT_OVERVIEW_LAYOUT,
  overviewLayoutReducer,
  type OverviewLayout,
} from "@/features/overview/layout/overview-layout";
import { createOverviewLayoutStore } from "@/features/overview/layout/use-overview-layout";
import type { StorageAdapter } from "@/data/storage-adapter";

const storage = async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.initialize();
  return adapter;
};

/** Wraps an adapter's `transact` to count calls, passing everything straight through. */
const wrapCountingTransact = (
  adapter: MemoryStorageAdapter,
  onCall: () => void,
): StorageAdapter => ({
  initialize: () => adapter.initialize(),
  readAll: (type) => adapter.readAll(type),
  putMany: (records, source) => adapter.putMany(records, source),
  clear: (source) => adapter.clear(source),
  transact: (work, options) => {
    onCall();
    return adapter.transact(work, options);
  },
});

describe("readOverviewLayout / writeOverviewLayout", () => {
  it("reads the default layout when nothing has been written", async () => {
    const adapter = await storage();
    const layout = await adapter.transact((tx) => readOverviewLayout(tx));
    expect(layout).toBe(DEFAULT_OVERVIEW_LAYOUT);
  });

  it("round-trips a written layout", async () => {
    const adapter = await storage();
    const custom: OverviewLayout = {
      version: 1,
      cards: [
        {
          id: "a",
          type: "goals",
          size: "compact",
          config: { pinnedGoalId: "g1" },
        },
      ],
    };
    await adapter.transact((tx) => writeOverviewLayout(tx, custom));
    const read = await adapter.transact((tx) => readOverviewLayout(tx));
    expect(read).toEqual(custom);
  });

  it("falls back to the default layout on corrupt stored JSON", async () => {
    const adapter = await storage();
    await adapter.transact((tx) =>
      writeMeta(tx, { [SYNC_META.overviewLayout]: "{not json" }),
    );
    const read = await adapter.transact((tx) => readOverviewLayout(tx));
    expect(read).toBe(DEFAULT_OVERVIEW_LAYOUT);
  });

  it("normalizes a stored layout with unknown widget types", async () => {
    const adapter = await storage();
    await adapter.transact((tx) =>
      writeMeta(tx, {
        [SYNC_META.overviewLayout]: JSON.stringify({
          version: 1,
          cards: [{ id: "a", type: "not-real" }],
        }),
      }),
    );
    const read = await adapter.transact((tx) => readOverviewLayout(tx));
    expect(read.cards).toEqual([]);
  });
});

describe("createOverviewLayoutStore", () => {
  it("starts loading and exposes the default layout before load() resolves", async () => {
    const adapter = await storage();
    const store = createOverviewLayoutStore({ storage: adapter });
    expect(store.getSnapshot()).toEqual({
      status: "loading",
      layout: DEFAULT_OVERVIEW_LAYOUT,
    });
    store.load();
    await flush();
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("reads whatever was already persisted once loaded", async () => {
    const adapter = await storage();
    const custom: OverviewLayout = {
      version: 1,
      cards: [{ id: "a", type: "accounts", size: "wide", config: {} }],
    };
    await adapter.transact((tx) => writeOverviewLayout(tx, custom));

    const store = createOverviewLayoutStore({ storage: adapter });
    store.load();
    await flush();
    expect(store.getSnapshot()).toEqual({ status: "ready", layout: custom });
  });

  it("load() only reads storage once even if called repeatedly", async () => {
    const adapter = await storage();
    let reads = 0;
    const counting = wrapCountingTransact(adapter, () => {
      reads += 1;
    });
    const store = createOverviewLayoutStore({ storage: counting });
    store.load();
    store.load();
    store.load();
    await flush();
    expect(reads).toBe(1);
  });

  it("dispatch persists before updating the snapshot, and notifies subscribers", async () => {
    const adapter = await storage();
    const store = createOverviewLayoutStore({ storage: adapter });
    store.load();
    await flush();

    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    const dispatchPromise = store.dispatch({
      type: "remove",
      id: "default-recent",
    });
    // Immediately after calling dispatch, nothing has persisted yet, so the snapshot must not
    // have moved.
    expect(
      store.getSnapshot().layout.cards.some((c) => c.id === "default-recent"),
    ).toBe(true);

    await dispatchPromise;
    expect(
      store.getSnapshot().layout.cards.some((c) => c.id === "default-recent"),
    ).toBe(false);
    expect(notified).toBeGreaterThan(0);

    const persisted = await adapter.transact((tx) => readOverviewLayout(tx));
    expect(persisted.cards.some((c) => c.id === "default-recent")).toBe(false);
  });

  it("a no-op dispatch does not write to storage", async () => {
    const adapter = await storage();
    let transactCalls = 0;
    const counting = wrapCountingTransact(adapter, () => {
      transactCalls += 1;
    });
    const store = createOverviewLayoutStore({ storage: counting });
    store.load();
    await flush();
    transactCalls = 0;

    await store.dispatch({ type: "remove", id: "does-not-exist" });
    expect(transactCalls).toBe(0);
  });

  it("a failing write leaves the snapshot unchanged and rejects", async () => {
    const adapter = await storage();
    const store = createOverviewLayoutStore({ storage: adapter });
    store.load();
    await flush();

    const before = store.getSnapshot();
    const failing: StorageAdapter = {
      initialize: () => adapter.initialize(),
      readAll: (type) => adapter.readAll(type),
      putMany: (records, source) => adapter.putMany(records, source),
      clear: (source) => adapter.clear(source),
      transact: () => Promise.reject(new Error("disk full")),
    };
    const failingStore = createOverviewLayoutStore({ storage: failing });
    failingStore.load();
    await flush();
    const beforeFailing = failingStore.getSnapshot();

    await expect(
      failingStore.dispatch({ type: "remove", id: "default-recent" }),
    ).rejects.toThrow("disk full");
    expect(failingStore.getSnapshot()).toEqual(beforeFailing);
    // Sanity: the untouched store did not observe anything from the failing one.
    expect(store.getSnapshot()).toEqual(before);
  });

  it("applies concurrent dispatches in call order", async () => {
    const adapter = await storage();
    const store = createOverviewLayoutStore({ storage: adapter });
    store.load();
    await flush();

    const firstAction = {
      type: "move",
      id: "default-recent",
      toIndex: 0,
    } as const;
    const secondAction = {
      type: "moveBy",
      id: "default-recent",
      delta: 1,
    } as const;
    // The expected result if the two actions are reduced strictly in call order, starting from
    // the layout the store loaded.
    const expected = overviewLayoutReducer(
      overviewLayoutReducer(DEFAULT_OVERVIEW_LAYOUT, firstAction),
      secondAction,
    );

    const first = store.dispatch(firstAction);
    const second = store.dispatch(secondAction);
    await Promise.all([first, second]);

    expect(store.getSnapshot().layout.cards.map((c) => c.id)).toEqual(
      expected.cards.map((c) => c.id),
    );

    const persisted = await adapter.transact((tx) => readOverviewLayout(tx));
    expect(persisted.cards.map((c) => c.id)).toEqual(
      expected.cards.map((c) => c.id),
    );
  });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
