/**
 * The device-local switch for automatic exchange rates (on by default, opt-out).
 *
 * Modeled directly on `readEndpoints` / `writeEndpoints` in `src/sync/transport/endpoints.ts`:
 * a small, tolerant reader and a small, explicit writer over the `sync_meta` key this feature
 * owns. Nothing here ever touches the network — `rate-service.ts` reads this flag in its own
 * transaction, decides whether to fetch, and only then leaves the transaction to call `fetch`.
 * Never inline `SYNC_META.ratesAutoFetch` outside this file.
 */

import type { StorageTx } from "@/data/storage-adapter";
import { SYNC_META, readMeta, writeMeta } from "@/data/sync-store";

export interface RatesFlag {
  /** On unless the user has explicitly turned this device's fetching off. */
  readonly enabled: boolean;
}

/** Reads the flag. Never throws — an unreadable value degrades to the default, not a crash. */
export async function readRatesFlag(tx: StorageTx): Promise<RatesFlag> {
  const meta = await readMeta(tx, [SYNC_META.ratesAutoFetch]);
  return {
    // On unless this device explicitly turned it off ("0"). An absent key — a fresh install, or
    // a vault from before this default flipped — reads as on.
    enabled: meta.get(SYNC_META.ratesAutoFetch) !== "0",
  };
}

export interface RatesFlagPatch {
  readonly enabled?: boolean;
}

/** Writes the fields present in `patch`. Fields left out are left untouched. */
export async function writeRatesFlag(
  tx: StorageTx,
  patch: RatesFlagPatch,
): Promise<void> {
  const entries: Partial<Record<string, string>> = {};
  if (patch.enabled !== undefined)
    entries[SYNC_META.ratesAutoFetch] = patch.enabled ? "1" : "0";
  await writeMeta(tx, entries);
}
