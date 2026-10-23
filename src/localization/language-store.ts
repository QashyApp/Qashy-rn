/**
 * Where this device's app-language preference actually lives, and where its device locales come
 * from. Thin I/O over the pure rules in `language-preference.ts`.
 *
 * - Android with the `qashy-locale` module: the native per-app locale is the source of truth, so
 *   the system Settings language picker and the in-app picker always agree. Reads are synchronous.
 * - Web, and Android without the module: `sync_meta` (`data/device-local/language-preference-store.ts`),
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
} from "@/data/device-local/language-preference-store";
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

/**
 * The raw native per-app locale list ("" = system), read synchronously; `null` when the store
 * is `sync_meta` instead. Raw, so an unsupported tag can still be told apart from "system".
 */
export function readNativeRawPreference(): string | null {
  return usesNativeLocale() ? QashyLocale.getApplicationLocales() : null;
}

/** The raw `sync_meta` value (`"system"` when absent). Never throws on odd values. */
export async function loadStoredRawPreference(): Promise<string> {
  return syncingStorage.transact((tx) => readLanguagePreference(tx), {
    silent: true,
  });
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
 * wrote, if any. It reads the current preference itself, when it runs, and writes only if that
 * is still "system" and setup is complete. On web that read-check-write is one transaction, so
 * nothing can land between the check and the write. `languageMigrated` is recorded only after
 * the preference landed, so a failed write is retried on the next launch.
 */
export async function migrateLegacyLanguage(input: {
  onboardingComplete: boolean;
  legacyLocale: string;
  deviceLocales: readonly string[];
}): Promise<LanguagePreference | null> {
  const android = isAndroid();
  const decide = (migrated: boolean, raw: string) =>
    decideLanguageMigration({
      ...input,
      migrated,
      currentPreference: normalizePreference(raw, android),
      android,
    });
  if (!usesNativeLocale()) {
    // No foreign await inside `work`: the transaction is all that is awaited.
    return syncingStorage.transact(
      async (tx) => {
        const migrated = await readLanguageMigrated(tx);
        const decided = decide(migrated, await readLanguagePreference(tx));
        if (migrated) return null;
        if (decided) await writeLanguagePreference(tx, decided);
        await writeLanguageMigrated(tx);
        return decided;
      },
      { silent: true },
    );
  }
  // The native per-app locale is not part of a storage transaction, but it is read synchronously
  // right before the write, and the provider's queue keeps its own writes out of the gap.
  const migrated = await syncingStorage.transact(
    (tx) => readLanguageMigrated(tx),
    { silent: true },
  );
  if (migrated) return null;
  // An unreadable per-app locale is not "system": deciding on it could pin the legacy language
  // over an explicit choice. A throwing read rejects, and a missing one skips, so either way the
  // migration is left for the next launch.
  const current = readNativeRawPreference();
  if (current === null) return null;
  const decided = decide(false, current);
  if (decided) await persistPreference(decided);
  try {
    await syncingStorage.transact((tx) => writeLanguageMigrated(tx), {
      silent: true,
    });
  } catch (reason) {
    // The preference landed, so report it. Without the flag the next launch runs this again,
    // harmlessly: native is no longer "system", so nothing is decided. With nothing written, a
    // failed flag is simply retried.
    if (!decided) throw reason;
  }
  return decided;
}
