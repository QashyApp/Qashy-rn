import {
  readOverviewLayout,
  writeOverviewLayout,
} from "@/data/device-local/overview-layout-store";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { StorageAdapter } from "@/data/storage-adapter";
import {
  DEFAULT_OVERVIEW_LAYOUT,
  overviewLayoutReducer,
} from "@/domain/overview-layout";
import { createOverviewLayoutStore } from "@/features/overview/layout/use-overview-layout";

const ids = (store: ReturnType<typeof createOverviewLayoutStore>) =>
  store.getOptimisticLayout().cards.map((card) => card.id);

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
    await expect(second).resolves.toBe(true);
    // Only the second drop landed; the failed first one is not smuggled in with it.
    expect(ids(store)).toEqual([D, A, B, C, E]);
  });

  it("keeps the first drop when only the second fails", async () => {
    const { store } = await readyStore(2);
    const first = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const second = store.dispatch({ type: "move", id: D, toIndex: 0 });
    await expect(first).resolves.toBe(true);
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

  it("resolves a no-op dispatch to false without writing", async () => {
    const { store, control } = await readyStore();
    await expect(
      store.dispatch({ type: "move", id: A, toIndex: 0 }),
    ).resolves.toBe(false);
    expect(control.writes).toBe(0);
  });

  it("resolves a real change to true", async () => {
    const { store } = await readyStore();
    await expect(
      store.dispatch({ type: "move", id: E, toIndex: 0 }),
    ).resolves.toBe(true);
  });

  it("resolves false when an earlier failure removed what the action relied on", async () => {
    const { store } = await readyStore(1);
    const first = store.dispatch({
      type: "add",
      card: { id: "extra", type: "goals" },
    });
    // Moving the card the failed add would have created changes nothing once it is gone.
    const second = store.dispatch({ type: "move", id: "extra", toIndex: 0 });
    await expect(first).rejects.toThrow("disk full");
    await expect(second).resolves.toBe(false);
  });
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What a fresh store reads from `storage`. */
async function readBack(storage: StorageAdapter) {
  return storage.transact((tx) => readOverviewLayout(tx));
}

/** A memory adapter that holds back every transaction while `gate.closed` is true. */
function gatedStorage() {
  const inner = new MemoryStorageAdapter();
  const gate = { closed: true, open: () => {}, failReads: false };
  let release: () => void = () => {};
  let opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  gate.open = () => {
    gate.closed = false;
    release();
  };
  const storage: StorageAdapter = Object.assign(Object.create(inner), {
    transact: async (...args: Parameters<StorageAdapter["transact"]>) => {
      if (gate.closed) await opened;
      if (gate.failReads) throw new Error("cannot open storage");
      return inner.transact(...args);
    },
  });
  return {
    storage,
    inner,
    gate,
    close: () => {
      gate.closed = true;
      opened = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  };
}

async function seedSaved(inner: StorageAdapter) {
  // Saved by an earlier session: reversed order, and the accounts card resized.
  const saved = overviewLayoutReducer(
    { version: 1, cards: [...DEFAULT_OVERVIEW_LAYOUT.cards].reverse() },
    { type: "resize", id: C, size: "wide" },
  );
  await inner.transact((tx) => writeOverviewLayout(tx, saved));
  return saved;
}

describe("overview layout store: dispatch before the saved layout loads", () => {
  it("persists the saved layout plus the action, not the default plus the action", async () => {
    const { storage, inner, gate } = gatedStorage();
    const saved = await seedSaved(inner);
    const store = createOverviewLayoutStore({ storage });

    // No load() first, and the read has not answered yet.
    const pending = store.dispatch({
      type: "add",
      card: { id: "extra", type: "goals" },
    });
    await settled();
    expect(store.getSnapshot().status).toBe("loading");

    gate.open();
    await pending;

    const onDisk = await readBack(inner);
    expect(onDisk.cards.map((card) => card.id)).toEqual([
      ...saved.cards.map((card) => card.id),
      "extra",
    ]);
    expect(onDisk.cards.find((card) => card.id === C)?.size).toBe("wide");
    expect(ids(store)).toEqual(onDisk.cards.map((card) => card.id));
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("applies a reset to a saved layout even though the placeholder is already the default", async () => {
    const { storage, inner, gate } = gatedStorage();
    await seedSaved(inner);
    const store = createOverviewLayoutStore({ storage });
    const pending = store.dispatch({ type: "reset" });
    gate.open();
    await pending;
    expect(await readBack(inner)).toEqual(DEFAULT_OVERVIEW_LAYOUT);
  });

  it("refuses to write over a saved layout it could not read", async () => {
    const { storage, inner, gate } = gatedStorage();
    const saved = await seedSaved(inner);
    gate.failReads = true;
    gate.open();
    const store = createOverviewLayoutStore({ storage });
    store.load();
    await settled();

    // The screen is not stuck loading; it shows the default as a read-only placeholder.
    expect(store.getSnapshot().status).toBe("unavailable");
    expect(ids(store)).toEqual([A, B, C, D, E]);

    await expect(store.dispatch({ type: "remove", id: A })).rejects.toThrow(
      "cannot open storage",
    );
    expect(await readBack(inner)).toEqual(saved);

    // Once storage answers, the next write builds on the saved layout.
    gate.failReads = false;
    await store.dispatch({ type: "remove", id: A });
    const onDisk = await readBack(inner);
    expect(onDisk.cards.map((card) => card.id)).toEqual(
      saved.cards.filter((card) => card.id !== A).map((card) => card.id),
    );
    expect(ids(store)).toEqual(onDisk.cards.map((card) => card.id));
  });
});

describe("overview layout store: optimistic order", () => {
  it("publishes the new order at once, keeps the committed one until the save lands, and takes it back on failure", async () => {
    const { store, control } = await readyStore();
    control.failAt.add(1);
    const saving = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const failure = expect(saving).rejects.toThrow("disk full");

    expect(store.getOptimisticLayout().cards.map((c) => c.id)).toEqual([
      E,
      A,
      B,
      C,
      D,
    ]);
    expect(store.getSnapshot().layout.cards.map((c) => c.id)).toEqual([
      A,
      B,
      C,
      D,
      E,
    ]);
    await failure;
    expect(store.getOptimisticLayout().cards.map((c) => c.id)).toEqual([
      A,
      B,
      C,
      D,
      E,
    ]);
  });

  it("keeps the same layout object when a settled save changes nothing visible", async () => {
    const { store } = await readyStore();
    const saving = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const shown = store.getOptimisticLayout();
    await saving;
    expect(store.getOptimisticLayout()).toBe(shown);
  });

  it("lands an anchored drop beside its neighbour after an earlier drop failed", async () => {
    const { store } = await readyStore(1);
    // Shown after the first drop: E, A, B, C, D. The second drop puts D between E and A.
    const first = store.dispatch({
      type: "place",
      id: E,
      toIndex: 0,
      beforeId: A,
    });
    const second = store.dispatch({
      type: "place",
      id: D,
      toIndex: 1,
      beforeId: A,
    });
    await expect(first).rejects.toThrow("disk full");
    await expect(second).resolves.toBe(true);
    // Before A, as dropped; an absolute index 1 would have put it after A.
    expect(ids(store)).toEqual([D, A, B, C, E]);
  });
});

describe("overview layout store: a write that never settles", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fails the write after the timeout and picks up a late-landing write on the next one", async () => {
    jest.useFakeTimers();
    const inner = new MemoryStorageAdapter();
    let hang = false;
    let landLate: () => Promise<unknown> = async () => undefined;
    const storage: StorageAdapter = Object.assign(Object.create(inner), {
      transact: (...args: Parameters<StorageAdapter["transact"]>) => {
        if (!hang) return inner.transact(...args);
        hang = false;
        // Never settles for the caller; the write itself lands later, on its own.
        landLate = () => inner.transact(...args);
        return new Promise(() => {});
      },
    });
    const store = createOverviewLayoutStore({ storage });
    store.load();
    await jest.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().status).toBe("ready");

    hang = true;
    const stuck = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const outcome = expect(stuck).rejects.toThrow(/too long/);
    await jest.advanceTimersByTimeAsync(9_999);
    expect(store.getOptimisticLayout().cards[0].id).toBe(E);
    await jest.advanceTimersByTimeAsync(1);
    await outcome;
    // Not blocked, and back on the committed order.
    expect(ids(store)).toEqual([A, B, C, D, E]);
    expect(store.getOptimisticLayout().cards.map((c) => c.id)).toEqual([
      A,
      B,
      C,
      D,
      E,
    ]);

    // The stuck write lands after the store gave up on it.
    await landLate();
    await store.dispatch({ type: "move", id: B, toIndex: 4 });

    // The next write was built on what was really on disk, late write included.
    const onDisk = await readBack(inner);
    expect(onDisk.cards.map((card) => card.id)).toEqual([E, A, C, D, B]);
    expect(ids(store)).toEqual([E, A, C, D, B]);
  });

  it("keeps later writes moving when one hangs", async () => {
    jest.useFakeTimers();
    const inner = new MemoryStorageAdapter();
    let calls = 0;
    const storage: StorageAdapter = Object.assign(Object.create(inner), {
      transact: (...args: Parameters<StorageAdapter["transact"]>) => {
        calls += 1;
        // Call 1 is the read; call 2 is the first write.
        if (calls === 2) return new Promise(() => {});
        return inner.transact(...args);
      },
    });
    const store = createOverviewLayoutStore({ storage });
    store.load();
    await jest.advanceTimersByTimeAsync(0);

    const first = store.dispatch({ type: "move", id: E, toIndex: 0 });
    const second = store.dispatch({ type: "resize", id: B, size: "wide" });
    const firstFailed = expect(first).rejects.toThrow(/too long/);
    await jest.advanceTimersByTimeAsync(10_000);
    await firstFailed;
    await jest.advanceTimersByTimeAsync(0);
    await expect(second).resolves.toBe(true);
    expect(
      store.getOptimisticLayout().cards.find((c) => c.id === B)?.size,
    ).toBe("wide");
  });
});

describe("overview layout store: a slow first read", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /** A store whose first read answers after `delayMs`; later transactions are immediate. */
  function slowFirstRead(delayMs: number) {
    const inner = new MemoryStorageAdapter();
    let reads = 0;
    const storage: StorageAdapter = Object.assign(Object.create(inner), {
      transact: async (...args: Parameters<StorageAdapter["transact"]>) => {
        reads += 1;
        if (reads === 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return inner.transact(...args);
      },
    });
    return { storage, inner };
  }

  it("shows the placeholder once the timeout passes and adopts the saved layout when the read lands", async () => {
    jest.useFakeTimers();
    const { storage, inner } = slowFirstRead(11_000);
    const saved = await seedSaved(inner);
    const savedIds = saved.cards.map((card) => card.id);
    const store = createOverviewLayoutStore({ storage });
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().status));

    store.load();
    await jest.advanceTimersByTimeAsync(9_999);
    // Still within the timeout: skeleton.
    expect(store.getSnapshot().status).toBe("loading");
    await jest.advanceTimersByTimeAsync(1);
    // The timeout has passed: the default is shown, but as a read-only placeholder, not as ready.
    expect(store.getSnapshot().status).toBe("unavailable");
    expect(ids(store)).toEqual([A, B, C, D, E]);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().layout.cards.map((card) => card.id)).toEqual(
      savedIds,
    );
    expect(ids(store)).toEqual(savedIds);
    // It was never ready on the default along the way.
    expect(seen.filter((status) => status === "ready")).toHaveLength(1);
    expect(seen.lastIndexOf("unavailable")).toBeLessThan(seen.indexOf("ready"));
  });

  it("stays on the placeholder, never loading or ready, while a read never answers", async () => {
    jest.useFakeTimers();
    const storage: StorageAdapter = Object.assign(
      Object.create(new MemoryStorageAdapter()),
      { transact: () => new Promise(() => {}) },
    );
    const store = createOverviewLayoutStore({ storage });
    store.load();
    await jest.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().status).toBe("loading");
    await jest.advanceTimersByTimeAsync(10_000);
    expect(store.getSnapshot().status).toBe("unavailable");
    expect(ids(store)).toEqual([A, B, C, D, E]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(store.getSnapshot().status).toBe("unavailable");
  });

  it("does not let a write made meanwhile persist over the saved layout", async () => {
    jest.useFakeTimers();
    const { storage, inner } = slowFirstRead(11_000);
    const saved = await seedSaved(inner);
    const store = createOverviewLayoutStore({ storage });
    store.load();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(store.getSnapshot().status).toBe("unavailable");

    const pending = store.dispatch({ type: "remove", id: A });
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBe(true);
    const onDisk = await readBack(inner);
    expect(onDisk.cards.map((card) => card.id)).toEqual(
      saved.cards.filter((card) => card.id !== A).map((card) => card.id),
    );
    expect(store.getSnapshot().status).toBe("ready");
  });
});

describe("overview layout store: recovering from a failed first read", () => {
  it("retries on reload and adopts the saved layout", async () => {
    const { storage, inner, gate } = gatedStorage();
    const saved = await seedSaved(inner);
    gate.failReads = true;
    gate.open();
    const store = createOverviewLayoutStore({ storage });
    store.load();
    await settled();
    expect(store.getSnapshot().status).toBe("unavailable");
    expect(ids(store)).toEqual([A, B, C, D, E]);

    // Still failing: a retry changes nothing and does not loop.
    store.reload();
    await settled();
    expect(ids(store)).toEqual([A, B, C, D, E]);
    expect(store.getSnapshot().status).toBe("unavailable");

    gate.failReads = false;
    store.reload();
    await settled();
    expect(store.getSnapshot().status).toBe("ready");
    expect(ids(store)).toEqual(saved.cards.map((card) => card.id));
    expect(store.getSnapshot().layout.cards.map((card) => card.id)).toEqual(
      saved.cards.map((card) => card.id),
    );
  });

  it("a retry that times out leaves the placeholder, not ready", async () => {
    jest.useFakeTimers();
    try {
      const inner = new MemoryStorageAdapter();
      let reads = 0;
      const storage: StorageAdapter = Object.assign(Object.create(inner), {
        transact: (...args: Parameters<StorageAdapter["transact"]>) => {
          reads += 1;
          // The first read fails; the retry never answers.
          if (reads === 1) return Promise.reject(new Error("cannot open"));
          return new Promise(() => {});
        },
      });
      const store = createOverviewLayoutStore({ storage });
      const seen: string[] = [];
      store.subscribe(() => seen.push(store.getSnapshot().status));
      store.load();
      await jest.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot().status).toBe("unavailable");

      store.reload();
      await jest.advanceTimersByTimeAsync(0);
      // Retrying does not bring the skeleton back, and is not ready.
      expect(store.getSnapshot().status).toBe("unavailable");
      await jest.advanceTimersByTimeAsync(10_000);
      expect(store.getSnapshot().status).toBe("unavailable");
      expect(seen).not.toContain("ready");
      expect(seen).not.toContain("loading");
    } finally {
      jest.useRealTimers();
    }
  });

  it("reload while an older read still hangs starts a new read that can recover", async () => {
    jest.useFakeTimers();
    try {
      const inner = new MemoryStorageAdapter();
      const saved = await seedSaved(inner);
      let reads = 0;
      const storage: StorageAdapter = Object.assign(Object.create(inner), {
        transact: (...args: Parameters<StorageAdapter["transact"]>) => {
          reads += 1;
          // The first read never answers; every later one does.
          if (reads === 1) return new Promise(() => {});
          return inner.transact(...args);
        },
      });
      const store = createOverviewLayoutStore({ storage });
      store.load();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(store.getSnapshot().status).toBe("unavailable");

      store.reload();
      await jest.advanceTimersByTimeAsync(0);
      expect(reads).toBe(2);
      expect(store.getSnapshot().status).toBe("ready");
      expect(ids(store)).toEqual(saved.cards.map((card) => card.id));
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not start a second read while the first is still within its timeout", async () => {
    jest.useFakeTimers();
    try {
      let reads = 0;
      const storage: StorageAdapter = Object.assign(
        Object.create(new MemoryStorageAdapter()),
        {
          transact: () => {
            reads += 1;
            return new Promise(() => {});
          },
        },
      );
      const store = createOverviewLayoutStore({ storage });
      store.load();
      await jest.advanceTimersByTimeAsync(5_000);
      store.reload();
      await jest.advanceTimersByTimeAsync(0);
      expect(reads).toBe(1);
      expect(store.getSnapshot().status).toBe("loading");
    } finally {
      jest.useRealTimers();
    }
  });

  it("leaves a loaded store alone on reload", async () => {
    const { store, control } = await readyStore();
    store.reload();
    await settled();
    expect(control.writes).toBe(0);
  });
});

describe("overview layout store: a drop before the saved layout loads", () => {
  it("moves the card at once over the placeholder, then lands on the saved layout", async () => {
    const { storage, inner, gate } = gatedStorage();
    const saved = await seedSaved(inner);
    const store = createOverviewLayoutStore({ storage });
    store.load();

    const pending = store.dispatch({ type: "move", id: B, toIndex: 0 });
    // Not loaded yet: the screen shows the placeholder with the drop already applied.
    expect(store.getSnapshot().status).toBe("loading");
    expect(ids(store)).toEqual([B, A, C, D, E]);

    gate.open();
    await expect(pending).resolves.toBe(true);
    const expected = [
      B,
      ...saved.cards.map((c) => c.id).filter((id) => id !== B),
    ];
    expect(ids(store)).toEqual(expected);
    expect((await readBack(inner)).cards.map((card) => card.id)).toEqual(
      expected,
    );
  });
});
