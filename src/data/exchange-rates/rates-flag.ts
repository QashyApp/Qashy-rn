/**
 * The device-local opt-in for automatic exchange rates.
 *
 * Modeled directly on `readEndpoints` / `writeEndpoints` in `src/sync/transport/endpoints.ts`:
 * a small, tolerant reader and a small, explicit writer over the two `sync_meta` keys this
 * feature owns. Nothing here ever touches the network — `rate-service.ts` reads this flag in
 * its own transaction, decides whether to fetch, and only then leaves the transaction to call
 * `fetch`. Never inline `SYNC_META.ratesAutoFetch` or `.ratesLastRefreshAt` outside this file.
 */

import type { StorageTx } from "@/data/storage-adapter";
import { SYNC_META, readMeta, writeMeta } from "@/data/sync-store";

export interface RatesFlag {
  /** Off unless the user has explicitly turned this device's fetching on. */
  readonly enabled: boolean;
  /** ISO timestamp of the last completed `refreshLatest`, or `null` before the first one. */
  readonly lastRefreshAt: string | null;
}

/** Reads the flag. Never throws — an unreadable value degrades to "off", not a crash. */
export async function readRatesFlag(tx: StorageTx): Promise<RatesFlag> {
  const meta = await readMeta(tx, [
    SYNC_META.ratesAutoFetch,
    SYNC_META.ratesLastRefreshAt,
  ]);
  return {
    enabled: meta.get(SYNC_META.ratesAutoFetch) === "1",
    lastRefreshAt: meta.get(SYNC_META.ratesLastRefreshAt) ?? null,
  };
}

export interface RatesFlagPatch {
  readonly enabled?: boolean;
  readonly lastRefreshAt?: string;
}

/** Writes the fields present in `patch`. Fields left out are left untouched. */
export async function writeRatesFlag(
  tx: StorageTx,
  patch: RatesFlagPatch,
): Promise<void> {
  const entries: Partial<Record<string, string>> = {};
  if (patch.enabled !== undefined)
    entries[SYNC_META.ratesAutoFetch] = patch.enabled ? "1" : "0";
  if (patch.lastRefreshAt !== undefined)
    entries[SYNC_META.ratesLastRefreshAt] = patch.lastRefreshAt;
  await writeMeta(tx, entries);
}
