/**
 * The body of the headless widget refresh, free of any app wiring so it can be tested with plain
 * fakes. It never rejects, and it always reports before resolving: the native worker cannot tell a
 * failed task from a finished one, so it retries whenever it was not told `true`.
 */
export interface HeadlessRefreshDeps {
  /** Opens the repository; may throw. */
  initialize(): Promise<void>;
  /** Resolves to whether the refresh completed; never rejects. */
  refresh(): Promise<boolean>;
  /** Tells the native worker whether the refresh completed. */
  report(ok: boolean): void;
  /** Receives only a fixed message and an error name, never a record. */
  warn(message: string): void;
}

export async function runHeadlessRefresh(
  deps: HeadlessRefreshDeps,
): Promise<void> {
  let ok = false;
  try {
    await deps.initialize();
    ok = await deps.refresh();
  } catch (error) {
    deps.warn(
      `[widgets] Headless refresh failed (${error instanceof Error ? error.name : "unknown"})`,
    );
  }
  try {
    deps.report(ok);
  } catch {
    // Without the report the worker treats the run as failed and retries; nothing else to do.
  }
}
