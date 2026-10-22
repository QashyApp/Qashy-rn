/**
 * App-side bindings for opt-in background sync: the schedule reconciler wired to the real
 * setting store and native module, and the one function the toggle calls.
 */

import {
  readBackgroundSync,
  writeBackgroundSync,
} from "@/data/background-sync-store";
import {
  reconcileBackgroundSchedule,
  type ScheduleSyncState,
} from "@/features/background-sync/schedule";
import {
  isBackgroundSyncAvailable,
  setBackgroundSync,
} from "../../../modules/qashy-widgets";

export {
  shouldScheduleBackgroundSync,
  type ScheduleSyncState,
} from "@/features/background-sync/schedule";
export { isBackgroundSyncAvailable };

/**
 * Reconciles the native schedule with the stored setting and the given sync state. Call on app
 * start and whenever the sync status changes (resume, pause, leave).
 */
export function syncBackgroundSchedule(
  state: ScheduleSyncState,
): Promise<boolean> {
  return reconcileBackgroundSchedule(
    {
      isAvailable: isBackgroundSyncAvailable,
      setNative: setBackgroundSync,
      readSetting: readBackgroundSync,
    },
    state,
  );
}

/** Persists the choice, then applies the schedule. Rejects only when the write fails. */
export async function setBackgroundSyncEnabled(
  enabled: boolean,
  state: ScheduleSyncState,
): Promise<void> {
  await writeBackgroundSync(enabled);
  await syncBackgroundSchedule(state);
}
