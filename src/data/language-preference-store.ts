/**
 * The device-local app-language preference, as stored in `sync_meta`.
 *
 * Modeled directly on `exchange-rates/rates-flag.ts`: a tolerant reader and an explicit writer
 * over the keys this feature owns (`SYNC_META.appLanguage`, `SYNC_META.languageMigrated`). This is
 * the web store, and the Android fallback when the native per-app locale module is missing; on
 * Android with the module the platform per-app locale is the source of truth instead.
 *
 * Writing through `transact` (never `putMany`) keeps it device-local: it never diffs into a sync
 * op, never lives in `AppSettings`, and needs no entry in the sync merge registry. Never inline
 * these `SYNC_META` keys outside this file.
 */

import type { StorageTx } from "@/data/storage-adapter";
import { SYNC_META, readMeta, writeMeta } from "@/data/sync-store";

/** The stored preference, `"system"` when nothing is stored. Never throws on odd values. */
export async function readLanguagePreference(tx: StorageTx): Promise<string> {
  const meta = await readMeta(tx, [SYNC_META.appLanguage]);
  const value = meta.get(SYNC_META.appLanguage)?.trim();
  return value ? value : "system";
}

export async function writeLanguagePreference(
  tx: StorageTx,
  preference: string,
): Promise<void> {
  await writeMeta(tx, { [SYNC_META.appLanguage]: preference });
}

/** Whether the one-time legacy-language migration has already run on this device. */
export async function readLanguageMigrated(tx: StorageTx): Promise<boolean> {
  const meta = await readMeta(tx, [SYNC_META.languageMigrated]);
  return meta.get(SYNC_META.languageMigrated) === "1";
}

export async function writeLanguageMigrated(tx: StorageTx): Promise<void> {
  await writeMeta(tx, { [SYNC_META.languageMigrated]: "1" });
}
