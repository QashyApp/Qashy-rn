/**
 * A translator for code that runs outside the React tree (home-screen widget snapshots, built from
 * a headless task as well as from the app).
 *
 * It resolves the device-local language exactly as `LocalizationProvider` does — the Android
 * per-app locale, else the `sync_meta` preference, normalized against the supported languages and
 * the device locales — and loads a Play-translated language's table through the same loader. The
 * result is a snapshot of that moment; call it again to follow a language change.
 */

import {
  appLanguageFromLocale,
  isAndroid,
  normalizePreference,
  resolveLocale,
  SYSTEM_PREFERENCE,
  type AppLanguage,
} from "@/localization/language-preference";
import {
  loadStoredRawPreference,
  readDeviceLocales,
  readNativeRawPreference,
} from "@/localization/language-store";
import {
  ensureNativeTable,
  translateMessage,
} from "@/localization/localization";

export interface StandaloneTranslator {
  /** The resolved supported tag (`en-US`, `he-IL`) that numbers, money and dates are formatted with. */
  locale: string;
  language: AppLanguage;
  t: (message: string) => string;
}

async function readRawPreference(): Promise<string> {
  try {
    const native = readNativeRawPreference();
    if (native !== null) return native;
  } catch {
    return SYSTEM_PREFERENCE;
  }
  try {
    return await loadStoredRawPreference();
  } catch {
    return SYSTEM_PREFERENCE;
  }
}

export async function createStandaloneTranslator(): Promise<StandaloneTranslator> {
  const android = isAndroid();
  const preference = normalizePreference(await readRawPreference(), android);
  const locale = resolveLocale(preference, readDeviceLocales(), android);
  const language = appLanguageFromLocale(locale, android);
  if (language !== "en" && language !== "he") await ensureNativeTable(locale);
  return {
    locale,
    language,
    t: (message) => translateMessage(message, language),
  };
}
