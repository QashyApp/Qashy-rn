import { AppState } from "react-native";

import { readBackgroundSync } from "@/data/device-local/background-sync-store";
import {
  financeRepository,
  syncingStorage,
} from "@/data/local-finance-repository";
import { SYNC_META, readMeta } from "@/data/sync-store";
import { refreshWidgets } from "@/features/widgets/refresher";
import {
  runBackgroundSync,
  type BackgroundSyncOutcome,
  type BackgroundSyncStatus,
} from "@/sync/background";
import { KeystoreError } from "@/sync/keystore";
import { createPlatformKeystore } from "@/sync/keystore/platform";
import { withSyncPassLock } from "@/sync/pass-lock";
import { SyncRuntime } from "@/sync/runtime";
import { setBackgroundSync } from "../../../modules/qashy-widgets";

/**
 * Wires `runBackgroundSync` to the real app: repository, storage, keystore, sync runtime,
 * widgets and the native schedule. Loaded lazily by the headless task (`headless.native.ts`),
 * only when it actually runs.
 */

/** Budget for the pass itself; the native side gives the whole task a little more. */
const PASS_TIMEOUT_MS = 40_000;

export async function runBackgroundSyncOnce(): Promise<BackgroundSyncOutcome> {
  const keystore = createPlatformKeystore();
  const runtime = new SyncRuntime({
    storage: syncingStorage,
    repository: financeRepository,
    keystore,
    // Failures land in the activity log the sync screen shows; nothing here may log them.
    onError: () => undefined,
  });

  try {
    return await runBackgroundSync({
      isForeground: () => AppState.currentState === "active",
      openStorage: () => syncingStorage.initialize(),
      readSetting: readBackgroundSync,
      // The headless widget refresh does the same: no recurring generation, no startup sweep.
      initializeRepository: () =>
        financeRepository.initialize({ generateRecurring: false }),
      async readStatus(): Promise<BackgroundSyncStatus> {
        const meta = await syncingStorage.transact(
          (tx) => readMeta(tx, [SYNC_META.enabled]),
          { silent: true },
        );
        if (meta.get(SYNC_META.enabled) !== "1") {
          return { enabled: false, keystore: "empty", deviceId: "" };
        }
        try {
          const vault = await keystore.read();
          return vault
            ? {
                enabled: true,
                keystore: "unlocked",
                deviceId: vault.identity.deviceId,
              }
            : { enabled: true, keystore: "empty", deviceId: "" };
        } catch (error) {
          // A keystore that will not answer (locked, unavailable) is an ordinary state: skip.
          // Anything else is a bug and propagates.
          if (error instanceof KeystoreError) {
            return {
              enabled: true,
              keystore: error.code === "locked" ? "locked" : "unavailable",
              deviceId: "",
            };
          }
          throw error;
        }
      },
      // The same arming the foreground does after reading status.
      arm: (deviceId) => syncingStorage.setDeviceId(deviceId),
      reconcile: (signal) => runtime.reconcile(signal),
      refreshWidgets: () => refreshWidgets(),
      cancelSchedule: () => setBackgroundSync(false),
      withLock: withSyncPassLock,
      timeoutMs: PASS_TIMEOUT_MS,
    });
  } finally {
    await runtime.close();
  }
}
