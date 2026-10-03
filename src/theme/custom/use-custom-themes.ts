/**
 * The app-wide store of user-authored themes and the hook that reads it (Phase 11).
 *
 * Same shape as `use-overview-layout.ts`: one module-scope `useSyncExternalStore` store, so the
 * themes survive screens unmounting and `QashyThemeProvider` can read them. It lives in
 * `src/theme/custom/` because the theme provider consumes it; it must therefore never import
 * `@/theme/theme` (that would be a cycle).
 *
 * Persistence goes through `data/custom-themes-store.ts` inside `storage.transact`, which never
 * captures a sync op, so custom themes stay device-local. Every stored file is re-parsed on load:
 * a file that no longer parses is dropped, and nothing here ever throws into a render. Theme
 * contents are never logged.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { deleteCustomThemeFile, loadCustomThemeFiles, saveCustomThemeFile } from '@/data/custom-themes-store';
import { syncingStorage } from '@/data/local-finance-repository';
import type { StorageAdapter, StorageTx } from '@/data/storage-adapter';
import { parseCustomTheme, type CustomThemeFile } from '@/theme/custom/schema';
import type { ThemeDefinition } from '@/theme/themes/types';

export interface CustomThemesSnapshot {
  readonly status: 'loading' | 'ready';
  readonly files: readonly CustomThemeFile[];
  /** Definitions of the files that parsed. Empty until loaded. */
  readonly themes: readonly ThemeDefinition[];
  /** Contrast-clamp notes from parsing, each prefixed with the theme id. */
  readonly warnings: readonly string[];
}

const EMPTY: readonly never[] = [];
const LOADING_SNAPSHOT: CustomThemesSnapshot = { status: 'loading', files: EMPTY, themes: EMPTY, warnings: EMPTY };

function buildSnapshot(files: readonly CustomThemeFile[]): CustomThemesSnapshot {
  const kept: CustomThemeFile[] = [];
  const themes: ThemeDefinition[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const result = parseCustomTheme(file);
    if (!result.ok) continue;
    kept.push(result.file);
    themes.push(result.theme);
    for (const warning of result.warnings) warnings.push(`${result.file.id}: ${warning}`);
  }
  return { status: 'ready', files: kept, themes, warnings };
}

export function createCustomThemesStore(deps: { storage: StorageAdapter }) {
  let snapshot: CustomThemesSnapshot = LOADING_SNAPSHOT;
  let loadStarted = false;
  let writeTail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const setSnapshot = (next: CustomThemesSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  function load() {
    if (loadStarted) return;
    loadStarted = true;
    void loadCustomThemeFiles(deps.storage)
      .then((files) => setSnapshot(buildSnapshot(files)))
      // Storage itself failed: behave as "no custom themes" so the provider settles on classic.
      .catch(() => setSnapshot(buildSnapshot([])));
  }

  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  /** Persists first and updates the snapshot only on success; rejects with the store's error otherwise. */
  function write(work: (tx: StorageTx) => Promise<CustomThemeFile[]>): Promise<void> {
    const attempt = writeTail.then(() => deps.storage.transact(work, { silent: true }));
    writeTail = attempt.then(() => undefined, () => undefined);
    return attempt.then((files) => {
      loadStarted = true;
      setSnapshot(buildSnapshot(files));
    });
  }

  return {
    load,
    getSnapshot,
    subscribe,
    save: (file: CustomThemeFile) => write((tx) => saveCustomThemeFile(tx, file)),
    remove: (id: string) => write((tx) => deleteCustomThemeFile(tx, id)),
  };
}

export type CustomThemesStore = ReturnType<typeof createCustomThemesStore>;

export const customThemesStore = createCustomThemesStore({ storage: syncingStorage });

export function useCustomThemes(): CustomThemesSnapshot & {
  readonly save: (file: CustomThemeFile) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
} {
  customThemesStore.load();
  const snapshot = useSyncExternalStore(customThemesStore.subscribe, customThemesStore.getSnapshot, customThemesStore.getSnapshot);
  const save = useCallback((file: CustomThemeFile) => customThemesStore.save(file), []);
  const remove = useCallback((id: string) => customThemesStore.remove(id), []);
  return { ...snapshot, save, remove };
}
