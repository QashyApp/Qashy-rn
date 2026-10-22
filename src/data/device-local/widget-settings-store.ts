/**
 * The device-local home-screen widget settings.
 *
 * Modeled on `overview-layout-store.ts` and `custom-themes-store.ts`: one `sync_meta` key
 * (`SYNC_META.widgetSettings`), a tolerant reader and an explicit writer. Writing through
 * `transact` rather than `putMany` keeps it device-local — `putMany` diffs every write into a
 * sync op, a direct `transact` on `syncingStorage` never captures one. Never inline
 * `SYNC_META.widgetSettings` outside this file.
 *
 * Writes go through one serial queue, so two concurrent read-modify-write callers can never
 * interleave their transactions, and listeners are told only after a write has committed.
 */

import { syncingStorage } from "@/data/local-finance-repository";
import { SYNC_META, readMeta, writeMeta } from "@/data/sync-store";
import {
  parseWidgetSettings,
  serializeWidgetSettings,
  type WidgetSettings,
} from "@/features/widgets/settings";

export {
  defaultWidgetConfig,
  type WidgetSettings,
} from "@/features/widgets/settings";

const listeners = new Set<() => void>();

/** Calls `listener` after every successful write on this device. Returns the unsubscribe. */
export function subscribeWidgetSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads the settings. Never throws on bad stored data: an absent key, unparseable JSON, or an
 * invalid field degrades to the defaults. The read notifies no subscriber.
 */
export function readWidgetSettings(): Promise<WidgetSettings> {
  return syncingStorage.transact(
    async (tx) => {
      const meta = await readMeta(tx, [SYNC_META.widgetSettings]);
      return parseWidgetSettings(meta.get(SYNC_META.widgetSettings));
    },
    { silent: true },
  );
}

let writeTail: Promise<unknown> = Promise.resolve();

function notify() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One listener's failure must not stop the others being told.
    }
  }
}

/**
 * Persists the settings (validated first, so invalid input can never be stored). Writes run one
 * at a time in call order. Rejects when the write fails; listeners are notified only on success.
 */
export function writeWidgetSettings(next: WidgetSettings): Promise<void> {
  const json = serializeWidgetSettings(next);
  const attempt = writeTail.then(() =>
    syncingStorage.transact(
      (tx) => writeMeta(tx, { [SYNC_META.widgetSettings]: json }),
      { silent: true },
    ),
  );
  writeTail = attempt.then(
    () => undefined,
    () => undefined,
  );
  return attempt.then(notify);
}

/**
 * Atomic read-modify-write on the same queue as `writeWidgetSettings`: `update` sees the settings
 * as committed by every earlier write and returns the next ones, or `null` to leave them alone
 * (nothing is written and no listener is told). Resolves with the settings now stored.
 */
export function updateWidgetSettings(
  update: (current: WidgetSettings) => WidgetSettings | null,
): Promise<WidgetSettings> {
  const attempt = writeTail.then(() =>
    syncingStorage.transact(
      async (tx) => {
        const meta = await readMeta(tx, [SYNC_META.widgetSettings]);
        const current = parseWidgetSettings(meta.get(SYNC_META.widgetSettings));
        const next = update(current);
        if (next === null) return { settings: current, written: false };
        const json = serializeWidgetSettings(next);
        await writeMeta(tx, { [SYNC_META.widgetSettings]: json });
        return { settings: parseWidgetSettings(json), written: true };
      },
      { silent: true },
    ),
  );
  writeTail = attempt.then(
    () => undefined,
    () => undefined,
  );
  return attempt.then(({ settings, written }) => {
    if (written) notify();
    return settings;
  });
}
