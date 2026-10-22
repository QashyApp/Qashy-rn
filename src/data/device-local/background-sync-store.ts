/**
 * The device-local switch for opt-in background sync (Android only).
 *
 * Modeled on `widget-settings-store.ts`: one `sync_meta` key (`SYNC_META.backgroundSync`), a
 * tolerant reader and an explicit writer. Written through `transact` rather than `putMany`, so
 * it never diffs into a sync op, and never held in `AppSettings`, which replicates to peers:
 * whether THIS device contacts the relay on a schedule is a per-device consent. Off by default;
 * only the exact value `'1'` means on. Never inline `SYNC_META.backgroundSync` outside this file.
 */

import { syncingStorage } from "@/data/local-finance-repository";
import type { StorageTx } from "@/data/storage-adapter";
import { SYNC_META, readMeta, writeMeta } from "@/data/sync-store";

const listeners = new Set<() => void>();

/** Calls `listener` after every successful write on this device. Returns the unsubscribe. */
export function subscribeBackgroundSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Transaction-level reader: off unless explicitly turned on. Never throws on bad data. */
export async function readBackgroundSyncFlag(tx: StorageTx): Promise<boolean> {
  const meta = await readMeta(tx, [SYNC_META.backgroundSync]);
  return meta.get(SYNC_META.backgroundSync) === "1";
}

/** Whether this device has opted into background sync. Notifies no subscriber. */
export function readBackgroundSync(): Promise<boolean> {
  return syncingStorage.transact((tx) => readBackgroundSyncFlag(tx), {
    silent: true,
  });
}

/** Persists the choice; listeners are told only after the write committed. */
export async function writeBackgroundSync(enabled: boolean): Promise<void> {
  await syncingStorage.transact(
    (tx) => writeMeta(tx, { [SYNC_META.backgroundSync]: enabled ? "1" : "0" }),
    { silent: true },
  );
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One listener's failure must not stop the others being told.
    }
  }
}
