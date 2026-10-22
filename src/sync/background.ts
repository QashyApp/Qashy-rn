/**
 * One opt-in background sync check-in (Android), free of any app wiring so it can be tested with
 * plain fakes. The wiring lives in `features/background-sync/headless.native.ts`.
 *
 * This is the single exception to "sync runs only when the user opens the app": while the user
 * has switched background sync on for this device, the OS starts this about every 30 minutes
 * when connected. See `docs/sync-threat-model.md` for the metadata it exposes.
 *
 * What it does, in order, and nothing more:
 *
 * 1. Skips when the app is in the foreground — the foreground seam already syncs.
 * 2. Reads the device-local setting; off means no work at all and the native schedule is
 *    cancelled (a stale schedule must not outlive its consent).
 * 3. Opens the repository **without** recurring generation or the archived sweep's startup
 *    pass, so no transaction is ever posted from a background wake.
 * 4. Takes the process-wide pass lock, so it can never overlap a foreground pass.
 * 5. Checks sync is enabled and the vault key is readable (a locked or unavailable keystore is
 *    an ordinary state: skip). Sync switched off or left cancels the schedule. This reads the
 *    keystore directly rather than through `readSyncStatus`, which can erase forgotten vault
 *    state; a background wake must never do that on a keystore that merely failed to answer.
 * 6. Runs exactly ONE `reconcile` through the same `SyncRuntime` the foreground uses. Incoming
 *    batches reach the repository only via `applyRemoteOps`. Fail closed: the engine rejects a
 *    whole batch on any signature, roster, chain or epoch failure, and nothing here catches
 *    such an error to carry on — it propagates to the task boundary, which reports failure.
 * 7. Refreshes the widgets so they show what just arrived.
 *
 * Nothing in here logs; the task boundary receives only an error name.
 */

import type { SyncPass } from "@/sync/runtime";

export type BackgroundSyncOutcome =
  /** The app is in the foreground; the foreground seam syncs. */
  | "foreground"
  /** The setting is off, or sync is paused / left. The native schedule was cancelled. */
  | "disabled"
  /** Sync is on but cannot run now (locked or unavailable keystore, unreadable state). */
  | "skipped"
  /** One pass ran and widgets were refreshed. */
  | "synced";

/** The slice of `SyncStatus` the task needs; structurally satisfied by it. */
export interface BackgroundSyncStatus {
  readonly enabled: boolean;
  readonly keystore: string;
  readonly deviceId: string;
}

export interface BackgroundSyncDeps {
  isForeground(): boolean;
  /** The device-local opt-in. Must work before the repository is initialized. */
  readSetting(): Promise<boolean>;
  /** Opens the storage adapter only (idempotent), so the setting can be read cheaply. */
  openStorage(): Promise<void>;
  /** Opens the repository WITHOUT generating recurring transactions. */
  initializeRepository(): Promise<void>;
  readStatus(): Promise<BackgroundSyncStatus>;
  /** Arms (id) or disarms (null) change capture, as the foreground does after reading status. */
  arm(deviceId: string | null): void;
  reconcile(signal: AbortSignal): Promise<SyncPass>;
  /** Rebuilds and pushes the widget snapshot; resolves to whether it completed. */
  refreshWidgets(): Promise<boolean>;
  /** Cancels the native periodic work. */
  cancelSchedule(): Promise<void>;
  /** Serializes with foreground passes. */
  withLock<T>(work: () => Promise<T>): Promise<T>;
  /** Hard budget for the pass, in milliseconds. */
  timeoutMs: number;
}

export async function runBackgroundSync(
  deps: BackgroundSyncDeps,
): Promise<BackgroundSyncOutcome> {
  if (deps.isForeground()) return "foreground";

  // Storage must be open to read the setting. The repository's own initialize (below) is the
  // one that hydrates and may do the one-time tombstone-erasure write, so a device with the
  // setting off never reaches it.
  await deps.openStorage();
  if (!(await deps.readSetting())) {
    await deps.cancelSchedule();
    return "disabled";
  }
  await deps.initializeRepository();

  return deps.withLock(async () => {
    // Re-checked inside the lock: the app may have been opened while this waited its turn.
    if (deps.isForeground()) return "foreground";

    const status = await deps.readStatus();
    // Only "sync is off" cancels. An unreadable or empty keystore is skipped without cancelling:
    // the foreground reconciles the schedule against the real state, and a transient keystore
    // refusal must not silently end the user's opt-in.
    if (!status.enabled) {
      deps.arm(null);
      await deps.cancelSchedule();
      return "disabled";
    }
    if (status.keystore !== "unlocked" || !status.deviceId) return "skipped";

    deps.arm(status.deviceId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    let pass: SyncPass;
    try {
      pass = await deps.reconcile(controller.signal);
    } finally {
      clearTimeout(timer);
    }
    if (pass.reason !== "ok") return "skipped";

    await deps.refreshWidgets();
    return "synced";
  });
}

export interface BackgroundSyncTaskDeps {
  /** Runs the work; may throw. */
  run(): Promise<unknown>;
  /** Tells the native worker whether the run completed; it retries a run not reported `true`. */
  report(ok: boolean): void;
  /** Receives only a fixed message and an error name, never a record. */
  warn(message: string): void;
}

/**
 * The task body: never rejects, and always reports before resolving, because the native worker
 * cannot tell a failed task from a finished one. A rejected pass (including any fail-closed
 * crypto rejection) is reported as a failure; it is neither retried here nor continued past.
 */
export async function runBackgroundSyncTask(
  deps: BackgroundSyncTaskDeps,
): Promise<void> {
  let ok = false;
  try {
    await deps.run();
    ok = true;
  } catch (error) {
    deps.warn(
      `[sync] Background sync failed (${error instanceof Error ? error.name : "unknown"})`,
    );
  }
  try {
    deps.report(ok);
  } catch {
    // Without the report the worker treats the run as failed and retries; nothing else to do.
  }
}
