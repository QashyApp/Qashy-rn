/**
 * The widget refresh loop, free of any app wiring so it can be tested with plain fakes.
 *
 * Serialized and coalesced: one run at a time, and any number of calls made during a run schedule
 * exactly one more run afterwards. A run pushes the snapshot only when it differs from the last
 * one pushed (ignoring `generatedAt`), and a failure is logged without any finance data and never
 * rejects.
 */

import type { WidgetSnapshot } from "@/features/widgets/snapshot";
import type { WidgetSettings } from "@/features/widgets/settings";

export interface PlacedWidgetRef {
  id: number;
  kind: "transactions" | "summary";
}

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
  let running: Promise<void> | null = null;
  let rerun = false;
  /** The last snapshot pushed in this process; `null` forces the next push. */
  let lastPushed: string | null = null;
  /** What the native store is known to hold: unknown at process start. */
  let nativeState: "unknown" | "pushed" | "cleared" = "unknown";

  async function runOnce(): Promise<void> {
    try {
      const placed = await deps.getPlacedWidgets();
      if (placed.length === 0) {
        // Nothing to draw. Clear what an earlier run (or an earlier process) may have left, once.
        if (nativeState !== "cleared") {
          await deps.clear();
          nativeState = "cleared";
        }
        lastPushed = null;
        return;
      }
      const settings = await deps.pruneSettings(
        new Set(placed.map((widget) => String(widget.id))),
      );
      const snapshot = await deps.buildSnapshot(placed, settings);
      if (!snapshot) return;
      const comparable = comparableSnapshot(snapshot);
      if (comparable === lastPushed) return;
      await deps.update(JSON.stringify(snapshot));
      lastPushed = comparable;
      nativeState = "pushed";
    } catch (error) {
      deps.log(
        "Widget refresh failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  function refresh(): Promise<void> {
    if (!deps.isAvailable()) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          rerun = false;
          await runOnce();
        } while (rerun);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  /** Deletes the stored snapshot and forgets the last push, so the next refresh pushes afresh. */
  async function clearData(): Promise<void> {
    if (!deps.isAvailable()) return;
    // Let a run in flight finish first, so it cannot push stale data after the clear.
    while (running) await running;
    try {
      await deps.clear();
      nativeState = "cleared";
    } catch (error) {
      deps.log(
        "Widget clear failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    lastPushed = null;
  }

  return { refresh, clearData };
}
