/**
 * The widget refresh loop, free of any app wiring so it can be tested with plain fakes.
 *
 * Serialized and coalesced: one run at a time, and any number of calls made during a run schedule
 * exactly one more run afterwards. A run pushes the snapshot only when it differs from the last
 * one pushed (ignoring `generatedAt`), and a failure is logged without any finance data and never
 * rejects. The promise resolves to whether the refresh completed (`true`), where "unchanged, so not
 * pushed" and "no widgets placed" count as completed; the headless task reports it to the native
 * worker, which retries a failure.
 */

import type { PlacedWidgetRef } from "@/features/widgets/kinds";
import type { WidgetSnapshot } from "@/features/widgets/snapshot";
import type { WidgetSettings } from "@/features/widgets/settings";

export type { PlacedWidgetRef };

export interface RefresherDeps {
  isAvailable(): boolean;
  getPlacedWidgets(): Promise<PlacedWidgetRef[]>;
  update(json: string): Promise<void>;
  clear(): Promise<void>;
  /** Drops stored configs of widgets that are no longer placed and returns the settings now stored. */
  pruneSettings(placedIds: ReadonlySet<string>): Promise<WidgetSettings>;
  /** Builds the snapshot, or `null` when the data is not ready yet (the next repository event retries). */
  buildSnapshot(
    placed: readonly PlacedWidgetRef[],
    settings: WidgetSettings,
  ): Promise<WidgetSnapshot | null>;
  /** Receives only a generic message and an error name, never a record. */
  log(message: string, errorName: string): void;
}

/** The snapshot as a string with the one volatile field blanked, for change detection. */
export function comparableSnapshot(snapshot: WidgetSnapshot): string {
  return JSON.stringify({ ...snapshot, generatedAt: "" });
}

export function createWidgetRefresher(deps: RefresherDeps) {
  let running: Promise<boolean> | null = null;
  let rerun = false;
  /** The last snapshot pushed in this process; `null` forces the next push. */
  let lastPushed: string | null = null;
  /** What the native store is known to hold: unknown at process start. */
  let nativeState: "unknown" | "pushed" | "cleared" = "unknown";
  /** Set by `clearData`; honoured at the start of the next run. */
  let clearRequested = false;
  /** Set by a forced refresh; the next run pushes even an unchanged snapshot. */
  let forceRequested = false;

  /** Resolves to whether this run completed; never rejects. */
  async function runOnce(): Promise<boolean> {
    let ok = true;
    if (forceRequested) {
      forceRequested = false;
      lastPushed = null;
    }
    if (clearRequested) {
      clearRequested = false;
      try {
        await deps.clear();
        nativeState = "cleared";
      } catch (error) {
        ok = false;
        deps.log(
          "Widget clear failed",
          error instanceof Error ? error.name : "unknown",
        );
      }
      lastPushed = null;
    }
    try {
      const placed = await deps.getPlacedWidgets();
      if (placed.length === 0) {
        // Nothing to draw. Clear what an earlier run (or an earlier process) may have left, once.
        if (nativeState !== "cleared") {
          await deps.clear();
          nativeState = "cleared";
        }
        lastPushed = null;
        return ok;
      }
      const settings = await deps.pruneSettings(
        new Set(placed.map((widget) => String(widget.id))),
      );
      const snapshot = await deps.buildSnapshot(placed, settings);
      // Data not ready: nothing was refreshed, so this is not a success.
      if (!snapshot) return false;
      const comparable = comparableSnapshot(snapshot);
      if (comparable === lastPushed) return ok;
      await deps.update(JSON.stringify(snapshot));
      lastPushed = comparable;
      nativeState = "pushed";
    } catch (error) {
      ok = false;
      deps.log(
        "Widget refresh failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    return ok;
  }

  /**
   * Resolves to whether the refresh completed (the result of the final run); never rejects.
   * `force` pushes even an unchanged snapshot, for when the native side asked for data: it may
   * have lost the stored snapshot without JS knowing (for instance after the last widget was removed).
   */
  function refresh(options?: { force?: boolean }): Promise<boolean> {
    if (!deps.isAvailable()) return Promise.resolve(true);
    if (options?.force) forceRequested = true;
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      let ok = true;
      try {
        do {
          rerun = false;
          ok = await runOnce();
        } while (rerun);
      } finally {
        running = null;
      }
      return ok;
    })();
    return running;
  }

  /**
   * Deletes the stored snapshot, forgets the last push, and rebuilds. The clear runs inside the
   * serialized loop (at the start of the next run, or of the rerun a run in flight schedules), so
   * it can never interleave with a refresh and the rebuild always comes after it.
   */
  function clearData(): Promise<boolean> {
    if (!deps.isAvailable()) return Promise.resolve(true);
    clearRequested = true;
    return refresh();
  }

  return { refresh, clearData };
}
