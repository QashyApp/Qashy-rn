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
  overviewLayoutReducer,
  type OverviewLayout,
  type OverviewLayoutAction,
} from "@/domain/overview-layout";

export interface OverviewLayoutSnapshot {
  readonly status: "loading" | "ready";
  readonly layout: OverviewLayout;
}

const LOADING_SNAPSHOT: OverviewLayoutSnapshot = {
  status: "loading",
  layout: DEFAULT_OVERVIEW_LAYOUT,
};

export interface OverviewLayoutStoreDeps {
  readonly storage: StorageAdapter;
}

export function createOverviewLayoutStore(deps: OverviewLayoutStoreDeps) {
  let snapshot: OverviewLayoutSnapshot = LOADING_SNAPSHOT;
  let loadStarted = false;
  const listeners = new Set<() => void>();

  // The last layout known to be on disk. Only a successful write (or the initial read) moves it.
  let committed: OverviewLayout = LOADING_SNAPSHOT.layout;
  // The actions accepted but not yet settled, oldest first. Writes run one at a time in this
  // order, so the head is the one in flight.
  const queue: OverviewLayoutAction[] = [];
  // What the layout will be once every queued action lands: `committed` with the queue replayed
  // on top. Each new `dispatch` reduces from it, so two dispatches made in the same tick (without
  // awaiting the first) still apply in call order. When a write fails the failed action leaves
  // the queue and this is rebuilt from `committed` and what is left, so it can never describe a
  // layout the screen never showed and storage never held.
  let base: OverviewLayout = committed;
  // Serializes the actual writes so two rapid dispatches persist and settle on disk in the
  // order they were made, rather than racing to see which write lands last.
  let writeTail: Promise<void> = Promise.resolve();

  const replay = (): OverviewLayout =>
    queue.reduce(
      (layout, action) => overviewLayoutReducer(layout, action),
      committed,
    );

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const setSnapshot = (next: OverviewLayoutSnapshot) => {
    snapshot = next;
    notify();
  };

  function load() {
    if (loadStarted) return;
    loadStarted = true;
    void deps.storage
      .transact((tx) => readOverviewLayout(tx))
      .then((layout) => {
        committed = layout;
        base = replay();
        setSnapshot({ status: "ready", layout });
      })
      .catch(() => {
        // Storage itself failed to open. Fall back to the default layout rather than leaving
        // the screen stuck on "loading" forever; a later successful dispatch will persist
        // normally.
        committed = DEFAULT_OVERVIEW_LAYOUT;
        base = replay();
        setSnapshot({ status: "ready", layout: DEFAULT_OVERVIEW_LAYOUT });
      });
  }

  function getSnapshot(): OverviewLayoutSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /**
   * Queues `action` and persists it before updating the in-memory snapshot, per AGENTS.md
   * ("update the in-memory snapshot only after persistence succeeds"). Returns a promise that
   * rejects on write failure so a caller can show an error and knows the on-screen layout has not
   * moved.
   *
   * Writes are serialized, and each one is reduced from the layout actually on disk when its turn
   * comes. So if an earlier write fails, the actions queued behind it are replayed on the last
   * committed layout and still land (each succeeding or failing on its own), and `base` is
   * rebuilt to match, rather than persisting a layout that assumed the failed change.
   */
  function dispatch(action: OverviewLayoutAction): Promise<void> {
    const optimistic = overviewLayoutReducer(base, action);
    if (optimistic === base) return Promise.resolve();
    base = optimistic;
    queue.push(action);

    const settle = () => {
      const at = queue.indexOf(action);
      if (at >= 0) queue.splice(at, 1);
    };

    const attempt = writeTail.then(async () => {
      const next = overviewLayoutReducer(committed, action);
      // The action no longer changes anything (an earlier failure removed what it relied on).
      if (next === committed) return;
      await deps.storage.transact((tx) => writeOverviewLayout(tx, next));
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
        setSnapshot({ status: "ready", layout: committed });
      },
      (error: unknown) => {
        settle();
        base = replay();
        throw error;
      },
    );
  }

  return { load, getSnapshot, subscribe, dispatch };
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
  readonly layout: OverviewLayout;
  readonly status: "loading" | "ready";
  readonly dispatch: (action: OverviewLayoutAction) => Promise<void>;
} {
  overviewLayoutStore.load();
  const snapshot = useSyncExternalStore(
    overviewLayoutStore.subscribe,
    overviewLayoutStore.getSnapshot,
    overviewLayoutStore.getSnapshot,
  );
  const dispatch = useCallback(
    (action: OverviewLayoutAction) => overviewLayoutStore.dispatch(action),
    [],
  );
  return { layout: snapshot.layout, status: snapshot.status, dispatch };
}
