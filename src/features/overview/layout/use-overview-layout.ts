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
} from "@/data/overview-layout-store";
import type { StorageAdapter } from "@/data/storage-adapter";
import {
  DEFAULT_OVERVIEW_LAYOUT,
  overviewLayoutReducer,
  type OverviewLayout,
  type OverviewLayoutAction,
} from "@/features/overview/layout/overview-layout";

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

  // The layout each new `dispatch` call reduces from. Updated synchronously, in call order,
  // before any write settles — so two dispatches made back to back in the same tick (without
  // awaiting the first) still apply in the order they were called, rather than both reducing
  // from whatever `snapshot.layout` happened to be when they were made. Rolled back if the
  // write it led to fails and nothing has moved it further since.
  let base: OverviewLayout = LOADING_SNAPSHOT.layout;
  // Serializes the actual writes so two rapid dispatches persist and settle on disk in the
  // order they were made, rather than racing to see which write lands last.
  let writeTail: Promise<void> = Promise.resolve();

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
        base = layout;
        setSnapshot({ status: "ready", layout });
      })
      .catch(() => {
        // Storage itself failed to open. Fall back to the default layout rather than leaving
        // the screen stuck on "loading" forever; a later successful dispatch will persist
        // normally.
        base = DEFAULT_OVERVIEW_LAYOUT;
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
   * Computes the next layout, and — only if it actually changed — persists before updating the
   * in-memory snapshot, per AGENTS.md ("update the in-memory snapshot only after persistence
   * succeeds"). Returns a promise that rejects on write failure so a caller can show an error
   * and knows the on-screen layout has not moved.
   */
  function dispatch(action: OverviewLayoutAction): Promise<void> {
    const from = base;
    const next = overviewLayoutReducer(from, action);
    if (next === from) return Promise.resolve();
    base = next;

    const attempt = writeTail.then(() =>
      deps.storage.transact((tx) => writeOverviewLayout(tx, next)),
    );
    // Keep the write chain alive even on failure, so a later dispatch's write still waits for
    // this attempt to settle rather than racing ahead of a write that never happened.
    writeTail = attempt.then(
      () => undefined,
      () => undefined,
    );

    return attempt.then(
      () => {
        setSnapshot({ status: "ready", layout: next });
      },
      (error: unknown) => {
        // Only undo the optimistic base if nothing has moved it further since — a later
        // dispatch already reduced from `next` and must not be silently discarded.
        if (base === next) base = from;
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
