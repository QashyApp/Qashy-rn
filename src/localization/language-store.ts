/**
 * Where this device's app-language preference actually lives, and where its device locales come
 * from. Thin I/O over the pure rules in `language-preference.ts`.
 *
 * - Android with the `qashy-locale` module: the native per-app locale is the source of truth, so
 *   the system Settings language picker and the in-app picker always agree. Reads are synchronous.
 * - Web, and Android without the module: `sync_meta` (`data/language-preference-store.ts`),
 *   written through `transact` so it stays device-local.
 *
 * Nothing here is ever written to `AppSettings`, which replicates to peers.
 */

import { getLocales } from "expo-localization";

import {
  readLanguageMigrated,
  readLanguagePreference,
  writeLanguageMigrated,
  writeLanguagePreference,
} from "@/data/language-preference-store";
import { syncingStorage } from "@/data/local-finance-repository";
import {
  decideLanguageMigration,
  isAndroid,
  normalizePreference,
  SYSTEM_PREFERENCE,
  type LanguagePreference,
} from "@/localization/language-preference";
import * as QashyLocale from "../../modules/qashy-locale";

/** Whether the native per-app locale is the source of truth on this device. */
export function usesNativeLocale(): boolean {
  return QashyLocale.isAvailable();
}

/**
 * The device's preferred locales, best first: the system list on Android, `navigator.languages`
 * on web, then expo-localization. Never throws and never returns an unusable value.
 */
export function readDeviceLocales(): string[] {
  const read: (() => readonly string[])[] = [
    () => (usesNativeLocale() ? QashyLocale.getSystemLocales() : []),
    () =>
      process.env.EXPO_OS === "web" && typeof navigator !== "undefined"
        ? (navigator.languages ??
          (navigator.language ? [navigator.language] : []))
        : [],
    () => getLocales().map((locale) => locale.languageTag),
  ];
  for (const source of read) {
    try {
      const tags = source().filter(
        (tag): tag is string => typeof tag === "string" && tag.length > 0,
      );
      if (tags.length) return tags;
    } catch {
      // Try the next source.
    }
  }
  return [];
}

/** The native preference, read synchronously; `null` when the store is `sync_meta` instead. */
export function readNativePreference(): LanguagePreference | null {
  if (!usesNativeLocale()) return null;
  return normalizePreference(QashyLocale.getApplicationLocales(), true);
}

/** The `sync_meta` preference. Absent or odd values degrade to `"system"`. */
export async function loadStoredPreference(): Promise<LanguagePreference> {
  const raw = await syncingStorage.transact(
    (tx) => readLanguagePreference(tx),
    {
      silent: true,
    },
  );
  return normalizePreference(raw, isAndroid());
}

/** The preference in effect right now, from wherever this device keeps it. */
export async function readCurrentPreference(): Promise<LanguagePreference> {
  return readNativePreference() ?? (await loadStoredPreference());
}

/** Persists a preference to wherever this device keeps it. Rejects when the write fails. */
export async function persistPreference(
  preference: LanguagePreference,
): Promise<void> {
  if (usesNativeLocale()) {
    await QashyLocale.setApplicationLocales(
      preference === SYSTEM_PREFERENCE ? "" : preference,
    );
    return;
  }
  await syncingStorage.transact(
    (tx) => writeLanguagePreference(tx, preference),
    {
      silent: true,
    },
  );
}

/**
 * Runs the one-time migration off the legacy `settings.locale`, and returns the preference it
 * wrote, if any. `languageMigrated` is written only after the preference landed, so a failed
 * write is retried on the next launch instead of being forgotten.
 */
export async function migrateLegacyLanguage(input: {
  currentPreference: LanguagePreference;
  legacyLocale: string;
  deviceLocales: readonly string[];
}): Promise<LanguagePreference | null> {
  const migrated = await syncingStorage.transact(
    (tx) => readLanguageMigrated(tx),
    { silent: true },
  );
  const decided = decideLanguageMigration({
    ...input,
    migrated,
    android: isAndroid(),
  });
  if (migrated) return null;
  // A choice made during the awaits above wins: write only if still on "system".
  let written: LanguagePreference | null = null;
  if (decided && (await readCurrentPreference()) === SYSTEM_PREFERENCE) {
    await persistPreference(decided);
    written = decided;
  }
  await syncingStorage.transact((tx) => writeLanguageMigrated(tx), {
    silent: true,
  });
  return written;
}
