/**
 * Keeps the native periodic work in step with the device-local setting and the sync state.
 * Pure over injected dependencies so it is testable with the native module mocked.
 *
 * The schedule exists exactly while ALL of these hold: the build can schedule (Android with the
 * native function), the user opted in on this device, sync is switched on, and this device holds
 * a vault. Anything else cancels it. Calls are idempotent (the native side keeps an existing
 * schedule), so they are safe on every app start and every sync status change.
 */

/** The slice of `SyncStatus` the schedule depends on. */
export interface ScheduleSyncState {
  readonly enabled: boolean;
  /** Empty until this device has been enrolled in a vault. */
  readonly deviceId: string;
}

export interface ScheduleDeps {
  isAvailable(): boolean;
  /** Schedules or cancels the native work. */
  setNative(enabled: boolean): Promise<void>;
  readSetting(): Promise<boolean>;
}

/** Whether background sync should be scheduled. */
export function shouldScheduleBackgroundSync(
  setting: boolean,
  state: ScheduleSyncState,
): boolean {
  return setting && state.enabled && state.deviceId !== "";
}

/**
 * Applies the desired schedule and resolves to it. Never rejects: a native failure is not worth
 * breaking a settings screen or the provider over, and the next call retries. A no-op (resolving
 * `false`) where the build cannot schedule.
 */
export async function reconcileBackgroundSchedule(
  deps: ScheduleDeps,
  state: ScheduleSyncState,
): Promise<boolean> {
  if (!deps.isAvailable()) return false;
  try {
    const desired = shouldScheduleBackgroundSync(
      await deps.readSetting(),
      state,
    );
    await deps.setNative(desired);
    return desired;
  } catch {
    return false;
  }
}
