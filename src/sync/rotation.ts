/**
 * The agreement between the keystore's vault epoch and `sync_meta`'s, and what to say when they
 * disagree.
 *
 * A key rotation writes two places that cannot be one atomic step: the keystore (the new key and
 * epoch) and the database (the new epoch, the revoked roster). If the process dies between them,
 * or the commit's outcome is unknowable, the two name different epochs. That is the "interrupted
 * rotation" state. Nothing may seal or apply under it — a pass would label ops with an epoch the
 * stored roster, chain and cursor do not belong to — so every entry point checks it and fails
 * closed with this message instead of guessing which side is right.
 *
 * No key material appears here, in the message or in the cause.
 */

import type { StorageAdapter } from "@/data/storage-adapter";
import { SYNC_META, readMeta } from "@/data/sync-store";

export const ROTATION_INTERRUPTED_MESSAGE =
  "Sync key rotation was interrupted before this device finished updating. Your data and local history are untouched. To get sync working again, use “Replace the vault key” or “Leave this vault” under Danger zone on the sync screen, then pair your devices again.";

/** The error every path throws for an interrupted rotation, with the underlying cause attached. */
export function rotationInterrupted(cause?: unknown): Error {
  return cause === undefined
    ? new Error(ROTATION_INTERRUPTED_MESSAGE)
    : new Error(ROTATION_INTERRUPTED_MESSAGE, { cause });
}

/** The epoch `sync_meta` records, or null when none has been written. One cheap read. */
export function readStoredEpoch(
  storage: StorageAdapter,
): Promise<string | null> {
  return storage.transact(async (tx) => {
    const meta = await readMeta(tx, [SYNC_META.epoch]);
    return meta.get(SYNC_META.epoch) ?? null;
  });
}

/**
 * Throws unless the keystore's epoch is the one the database records.
 *
 * A device with no recorded epoch yet is not interrupted, only unfinished, and is left to the
 * code that enrols it.
 */
export async function assertVaultEpochCurrent(
  storage: StorageAdapter,
  vaultEpoch: number,
): Promise<void> {
  const stored = await readStoredEpoch(storage);
  if (stored && stored !== String(vaultEpoch)) throw rotationInterrupted();
}
