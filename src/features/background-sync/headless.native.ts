import { AppRegistry } from "react-native";

import { runBackgroundSyncTask } from "@/sync/background";
import { reportHeadlessResult } from "../../../modules/qashy-widgets";

/**
 * The task the native WorkManager periodic work starts (about every 30 minutes, only while the
 * user has opted in on this device) to run ONE sync pass while the app is not open. Like the
 * widget refresh task it registers at bundle load, before any component exists, so it imports
 * only React Native, the tiny task body and the native module's thin wrapper; the repository,
 * the sync runtime and the keystore load inside the task, only when it actually runs.
 *
 * It never generates recurring transactions (`generateRecurring: false`) and writes nothing but
 * what applying remote ops and the sync engine's own bookkeeping require; see
 * `src/sync/background.ts` for the full sequence and the fail-closed behaviour.
 */
export const BACKGROUND_SYNC_TASK = "QashyBackgroundSync";

AppRegistry.registerHeadlessTask(
  BACKGROUND_SYNC_TASK,
  () => () =>
    runBackgroundSyncTask({
      async run() {
        // Lazy: the repository, sync runtime and keystore load only when the task runs.
        const { runBackgroundSyncOnce } =
          await import("@/features/background-sync/run");
        return runBackgroundSyncOnce();
      },
      report: reportHeadlessResult,
      // A fixed message and an error name only: no finance data or key material in a log.
      warn: (message) => console.warn(message),
    }),
);
