/**
 * The device-local store of user-authored themes (Phase 11 of docs/theming-plan.md).
 *
 * Modeled directly on `overview-layout-store.ts`: a tolerant reader over the one `sync_meta` key
 * this feature owns (`SYNC_META.customThemes`) and explicit writers that take a `tx`. Writing
 * through `transact` rather than `putMany` is what keeps this device-local: `putMany` diffs every
 * write into a sync op, `transact` is a documented pass-through that never captures one. These
 * themes therefore never replicate, never enter `AppSettings`, and need no entry in the sync merge
 * registry. Never inline `SYNC_META.customThemes` outside this file. Nothing here touches the
 * keystore, logs, URLs or the service-worker cache.
 *
 * Only the validated theme FILE is stored (the author's JSON), never the derived
 * `ThemeDefinition`, so a later change to how files resolve takes effect without a migration. The
 * reader re-parses every entry on each load: an entry that no longer parses is DROPPED, so a broken
 * custom theme falls back to the built-in default instead of crashing.
 */

import type { StorageAdapter, StorageTx } from '@/data/storage-adapter';
import { SYNC_META, readMeta, writeMeta } from '@/data/sync-store';
import { canonicalizeCustomThemeFile, parseCustomTheme, type CustomThemeFile } from '@/theme/custom/schema';

export const MAX_CUSTOM_THEMES = 8;
/** Total size of the stored JSON document, in characters. */
export const MAX_CUSTOM_THEMES_BYTES = 128 * 1024;

const STORE_VERSION = 1;

export type CustomThemeStoreErrorCode = 'invalid' | 'limit' | 'size';

export class CustomThemeStoreError extends Error {
  constructor(
    message: string,
    readonly code: CustomThemeStoreErrorCode,
  ) {
    super(message);
    this.name = 'CustomThemeStoreError';
  }
}

/** Parses stored JSON into valid, de-duplicated, capped files. Never throws. */
function normalize(raw: string | undefined): CustomThemeFile[] {
  if (raw === undefined || raw.length > MAX_CUSTOM_THEMES_BYTES) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const entries =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { themes?: unknown }).themes
      : undefined;
  if (!Array.isArray(entries)) return [];

  const files: CustomThemeFile[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (files.length >= MAX_CUSTOM_THEMES) break;
    const result = parseCustomTheme(entry);
    if (!result.ok || seen.has(result.file.id)) continue;
    seen.add(result.file.id);
    files.push(result.file);
  }
  return files;
}

function serialize(files: readonly CustomThemeFile[]): string {
  return JSON.stringify({ version: STORE_VERSION, themes: files.map(canonicalizeCustomThemeFile) });
}

/** Reads inside an open transaction. Absent, corrupt, oversized or stale data degrades to "no custom themes". */
export async function readCustomThemeFiles(tx: StorageTx): Promise<CustomThemeFile[]> {
  const meta = await readMeta(tx, [SYNC_META.customThemes]);
  return normalize(meta.get(SYNC_META.customThemes));
}

/** Reads the stored theme files. Never throws on bad data; the read notifies no subscriber. */
export function loadCustomThemeFiles(storage: StorageAdapter): Promise<CustomThemeFile[]> {
  return storage.transact((tx) => readCustomThemeFiles(tx), { silent: true });
}

/**
 * Adds a theme, or replaces the one with the same id. Re-validates, so an invalid file can never
 * be persisted; throws `CustomThemeStoreError` when it is invalid or a cap would be exceeded.
 * Returns the stored list.
 */
export async function saveCustomThemeFile(tx: StorageTx, file: CustomThemeFile): Promise<CustomThemeFile[]> {
  const result = parseCustomTheme(file);
  if (!result.ok) throw new CustomThemeStoreError(`Invalid custom theme: ${result.errors.join('; ')}`, 'invalid');

  const existing = await readCustomThemeFiles(tx);
  const index = existing.findIndex((entry) => entry.id === result.file.id);
  if (index < 0 && existing.length >= MAX_CUSTOM_THEMES) {
    throw new CustomThemeStoreError(`At most ${MAX_CUSTOM_THEMES} custom themes can be stored; delete one first.`, 'limit');
  }
  const next = index < 0 ? [...existing, result.file] : existing.map((entry, at) => (at === index ? result.file : entry));
  const json = serialize(next);
  if (json.length > MAX_CUSTOM_THEMES_BYTES) {
    throw new CustomThemeStoreError('Custom themes take too much space; delete one first.', 'size');
  }
  await writeMeta(tx, { [SYNC_META.customThemes]: json });
  return next;
}

/** Removes a theme by id. A missing id is a no-op. Returns the stored list. */
export async function deleteCustomThemeFile(tx: StorageTx, id: string): Promise<CustomThemeFile[]> {
  const existing = await readCustomThemeFiles(tx);
  const next = existing.filter((entry) => entry.id !== id);
  if (next.length === existing.length) return existing;
  await writeMeta(tx, { [SYNC_META.customThemes]: serialize(next) });
  return next;
}
