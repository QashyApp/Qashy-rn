/**
 * The app-wide Overview layout store and the hook that reads it.
 *
 * A small `useSyncExternalStore` store, the same pattern `exchange-rate-provider.tsx` uses for
 * `exchangeRateService`: constructed once at module scope (rather than inside a component) so
 * the layout survives the Overview screen unmounting and remounting — a form-sheet mutation
 * that replaces the Overview route should not flash back to the default layout while storage
 * is re-read.
 *
 * `createOverviewLayoutStore` takes its storage as a dependency so tests can hand it a
 * `MemoryStorageAdapter` instead of the real `syncingStorage` singleton; `overviewLayoutStore`
 * is the one default instance the app actually uses.
 */

import { useCallback, useSyncExternalStore } from "react";

import { syncingStorage } from "@/data/local-finance-repository";
import {
  readOverviewLayout,
  writeOverviewLayout,
} from "@/data/device-local/overview-layout-store";
import type { StorageAdapter } from "@/data/storage-adapter";
import {
  DEFAULT_OVERVIEW_LAYOUT,
  type OverviewLayout,
} from "@/domain/overview-layout";
import {
  reduceLayoutAction,
  type LayoutStoreAction,
} from "@/features/overview/layout/layout-actions";

export interface OverviewLayoutSnapshot {
  readonly status: "loading" | "ready";
  /**
   * The last layout known to be on disk (the default while loading, or while the saved layout
   * cannot be read).
   */
  readonly layout: OverviewLayout;
}

const LOADING_SNAPSHOT: OverviewLayoutSnapshot = {
  status: "loading",
  layout: DEFAULT_OVERVIEW_LAYOUT,
};

/** How long one storage transaction may take before the store stops waiting for it. */
export const STORAGE_TIMEOUT_MS = 10_000;

export interface OverviewLayoutStoreDeps {
  readonly storage: StorageAdapter;
  /** Overrides `STORAGE_TIMEOUT_MS`; tests use a small value with fake timers. */
  readonly storageTimeoutMs?: number;
}

class StorageTimeoutError extends Error {
  constructor() {
    super("Saving your overview took too long. Try again.");
    this.name = "StorageTimeoutError";
  }
}

/** Rejects if `work` has not settled in `ms`. `work` itself is left running. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StorageTimeoutError()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const sameCards = (a: OverviewLayout, b: OverviewLayout) =>
  a === b ||
  (a.cards.length === b.cards.length &&
    a.cards.every((card, index) => card === b.cards[index]));

export function createOverviewLayoutStore(deps: OverviewLayoutStoreDeps) {
  const timeoutMs = deps.storageTimeoutMs ?? STORAGE_TIMEOUT_MS;
  let snapshot: OverviewLayoutSnapshot = LOADING_SNAPSHOT;
  // What the screen shows: `snapshot.layout` with every accepted-but-unsettled action replayed on
  // top. A drop appears here at once, stays while its save runs, and leaves again if the save
  // fails. Kept beside the snapshot (not in it) so the snapshot stays "what is on disk".
  let optimistic: OverviewLayout = DEFAULT_OVERVIEW_LAYOUT;
  let loadStarted = false;
  // The first read has settled, either way. Until then the screen shows the loading state.
  let loaded = false;
  const listeners = new Set<() => void>();

  // The last layout read from or written to disk. Only the initial read, a re-read or a
  // successful write moves it.
  let committed: OverviewLayout = DEFAULT_OVERVIEW_LAYOUT;
  // `committed` came from disk at some point. False until the first read succeeds; while false
  // it is only a placeholder for the screen and no write may be built on it.
  let hasCommitted = false;
  // Nothing can have changed the disk behind `committed` since it was read. A write that timed
  // out may still land later, so this goes false and the next write re-reads before it reduces.
  let fresh = false;
  // The actions accepted but not yet settled, oldest first. Writes run one at a time in this
  // order, so the head is the one in flight.
  const queue: LayoutStoreAction[] = [];
  // Serializes everything that touches storage - the first read included - so a dispatch made
  // before the saved layout has loaded waits for it and is reduced from it, never from the
  // default, and two rapid dispatches persist in the order they were made.
  let writeTail: Promise<void> = Promise.resolve();

  const replay = (): OverviewLayout =>
    queue.reduce(
      (layout, action) => reduceLayoutAction(layout, action),
      committed,
    );

  /** Recomputes the snapshot from the current state and tells subscribers. */
  const publish = () => {
    const shownCommitted = hasCommitted ? committed : DEFAULT_OVERVIEW_LAYOUT;
    // Each action is replayed on the committed layout; until that is known the queue has nothing
    // to be replayed on.
    const replayed = hasCommitted ? replay() : DEFAULT_OVERVIEW_LAYOUT;
    // Keep the previous object when nothing visible changed, so memoised screens skip the render.
    if (!sameCards(optimistic, replayed)) optimistic = replayed;
    snapshot = { status: loaded ? "ready" : "loading", layout: shownCommitted };
    for (const listener of listeners) listener();
  };

  async function readCommitted(): Promise<void> {
    committed = await withTimeout(
      deps.storage.transact((tx) => readOverviewLayout(tx)),
      timeoutMs,
    );
    hasCommitted = true;
    fresh = true;
  }

  /**
   * Starts reading the saved layout, once. The read joins the write chain, so any write made
   * before it settles waits behind it.
   *
   * If the read fails (storage would not open) the screen falls back to the default layout so it
   * is not stuck on "loading", but that default is a placeholder: the saved layout is unknown, so
   * no write is allowed to replace it. Each write retries the read first and fails with the
   * read's error if it still cannot be done, leaving whatever is on disk alone.
   */
  function load() {
    if (loadStarted) return;
    loadStarted = true;
    writeTail = writeTail
      .then(readCommitted)
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        loaded = true;
        publish();
      });
  }

  function getSnapshot(): OverviewLayoutSnapshot {
    return snapshot;
  }

  /** The layout to show: the saved one with every unsettled change applied. */
  function getOptimisticLayout(): OverviewLayout {
    return optimistic;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /**
   * Queues `action` and persists it before it becomes the saved layout, per AGENTS.md ("update
   * the in-memory snapshot only after persistence succeeds"). It is shown at once through
   * `optimistic`, and the returned promise rejects on a write failure so a caller can show an
   * error; the snapshot then goes back to what is on disk.
   *
   * Writes are serialized, and each one is reduced from the layout actually on disk when its
   * turn comes. So if an earlier write fails, the actions queued behind it are replayed on the
   * last committed layout and still land (each succeeding or failing on its own), and
   * `optimistic` is rebuilt to match, rather than persisting a layout that assumed the failed
   * change. A dispatch made before the saved layout has loaded waits for it.
   *
   * A transaction that does not settle within the timeout fails the write. It may still land
   * later, so the next write re-reads the layout before building on it.
   */
  function dispatch(action: LayoutStoreAction): Promise<void> {
    load();
    if (hasCommitted) {
      // Judged against what is shown; before the saved layout is known there is nothing to
      // compare with (a `reset` to the default may still change the saved one).
      if (reduceLayoutAction(optimistic, action) === optimistic)
        return Promise.resolve();
    }
    queue.push(action);
    publish();

    const settle = () => {
      const at = queue.indexOf(action);
      if (at >= 0) queue.splice(at, 1);
    };

    const attempt = writeTail.then(async () => {
      if (!fresh) {
        await readCommitted();
        loaded = true;
        publish();
      }
      const next = reduceLayoutAction(committed, action);
      // The action no longer changes anything (an earlier failure removed what it relied on).
      if (next === committed) return;
      try {
        await withTimeout(
          deps.storage.transact((tx) => writeOverviewLayout(tx, next)),
          timeoutMs,
        );
      } catch (error) {
        // A write that timed out may still land, so what is on disk is no longer known.
        if (error instanceof StorageTimeoutError) fresh = false;
        throw error;
      }
      committed = next;
    });
    // Keep the write chain alive even on failure, so a later dispatch's write still waits for
    // this attempt to settle rather than racing ahead of a write that never happened.
    writeTail = attempt.then(
      () => undefined,
      () => undefined,
    );

    return attempt.then(
      () => {
        settle();
        publish();
      },
      (error: unknown) => {
        settle();
        publish();
        throw error;
      },
    );
  }

  return { load, getSnapshot, getOptimisticLayout, subscribe, dispatch };
}

export type OverviewLayoutStore = ReturnType<typeof createOverviewLayoutStore>;

/**
 * The one instance for the app's lifetime, exactly like `financeRepository` and
 * `exchangeRateService`.
 */
export const overviewLayoutStore = createOverviewLayoutStore({
  storage: syncingStorage,
});

export function useOverviewLayout(): {
  /** The layout to show: the saved one with every unsettled change already applied. */
  readonly layout: OverviewLayout;
  readonly status: "loading" | "ready";
  readonly dispatch: (action: LayoutStoreAction) => Promise<void>;
} {
  overviewLayoutStore.load();
  const snapshot = useSyncExternalStore(
    overviewLayoutStore.subscribe,
    overviewLayoutStore.getSnapshot,
    overviewLayoutStore.getSnapshot,
  );
  const dispatch = useCallback(
    (action: LayoutStoreAction) => overviewLayoutStore.dispatch(action),
    [],
  );
  const layout = useSyncExternalStore(
    overviewLayoutStore.subscribe,
    overviewLayoutStore.getOptimisticLayout,
    overviewLayoutStore.getOptimisticLayout,
  );
  return { layout, status: snapshot.status, dispatch };
}
