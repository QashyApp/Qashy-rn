/**
 * Pure rules for the app language: what is supported, how a preference resolves to a locale,
 * which languages are right-to-left, and the one-time migration off the legacy `settings.locale`.
 *
 * The language is a per-device preference — `"system"` (the default) or an explicit supported
 * tag. It is never stored in `AppSettings` and never synced. No I/O happens here: the storage
 * facade lives in `language-store.ts`, so every rule below is testable without a device.
 */

import languages from "@/localization/languages.json";

/** The interface languages that have a translation dictionary. */
export type AppLanguage = "en" | "he";

/** `"system"` (follow the device) or an explicit supported BCP-47 tag such as `he-IL`. */
export type LanguagePreference = string;

export interface LanguageOption {
  /** BCP-47 tag, also the locale every number, money and date is formatted with. */
  readonly tag: string;
  /** The language's own name, shown verbatim whatever the UI language is. */
  readonly label: string;
}

export const SYSTEM_PREFERENCE = "system";
export const FALLBACK_LOCALE = "en-US";

/** Languages shipped inside the app. */
export const BUNDLED_LANGUAGES: readonly LanguageOption[] = languages.bundled;
/** Languages Google Play delivers on demand. Android only; empty until translations ship. */
export const PLAY_TRANSLATED_LANGUAGES: readonly LanguageOption[] =
  languages.playTranslated as readonly LanguageOption[];

/** Language subtags written right to left. */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  "he",
  "ar",
  "fa",
  "ur",
  "yi",
]);

/** Legacy ISO 639 codes Android and old browsers still report. */
const LEGACY_SUBTAGS: Record<string, string> = { iw: "he", in: "id", ji: "yi" };

/** The lowercase primary language subtag of a tag: `he-IL` and `iw` are both `he`. */
export function languageSubtag(tag: string): string {
  const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
  return LEGACY_SUBTAGS[primary] ?? primary;
}

/** The interface language whose dictionary a locale uses. Anything but Hebrew reads English. */
export function languageFromLocale(locale: string): AppLanguage {
  return languageSubtag(locale) === "he" ? "he" : "en";
}

export function isRtlLocale(locale: string): boolean {
  return RTL_LANGUAGES.has(languageSubtag(locale));
}

/** Whether Play-delivered languages may be offered: Android only. */
export const isAndroid = () => process.env.EXPO_OS === "android";

/** Bundled languages, plus the Play-delivered ones on Android. */
export function supportedLanguages(android: boolean): LanguageOption[] {
  return android
    ? [...BUNDLED_LANGUAGES, ...PLAY_TRANSLATED_LANGUAGES]
    : [...BUNDLED_LANGUAGES];
}

const canonical = (tag: string) => tag.trim().replace(/_/g, "-").toLowerCase();

/** The supported entry for a tag: an exact match first, otherwise the first of the same language. */
export function matchSupportedLanguage(
  tag: string,
  android: boolean,
): LanguageOption | undefined {
  const supported = supportedLanguages(android);
  const exact = canonical(tag);
  const subtag = languageSubtag(tag);
  if (!subtag) return undefined;
  return (
    supported.find((option) => canonical(option.tag) === exact) ??
    supported.find((option) => languageSubtag(option.tag) === subtag)
  );
}

/**
 * What `"system"` resolves to: the supported tag of the first device locale whose language is
 * supported, otherwise `en-US`. Device `en-GB` gives `en-US`; device `he` gives `he-IL`.
 */
export function resolveSystemLocale(
  deviceLocales: readonly string[],
  android: boolean,
): string {
  for (const deviceLocale of deviceLocales) {
    const match = matchSupportedLanguage(deviceLocale, android);
    if (match) return match.tag;
  }
  return FALLBACK_LOCALE;
}

/**
 * The locale the whole UI formats with. An explicit preference wins when it names a supported
 * language (a Play-translated one only on Android); anything else behaves like `"system"`.
 */
export function resolveLocale(
  preference: LanguagePreference,
  deviceLocales: readonly string[],
  android: boolean,
): string {
  if (preference !== SYSTEM_PREFERENCE) {
    const match = matchSupportedLanguage(preference, android);
    if (match) return match.tag;
  }
  return resolveSystemLocale(deviceLocales, android);
}

/**
 * Turns whatever a store returned into a preference. Empty, absent or unsupported values mean
 * `"system"`; the first tag of a comma-separated Android locale list is the one in effect.
 */
export function normalizePreference(
  raw: string | null | undefined,
  android: boolean,
): LanguagePreference {
  const first = (raw ?? "").split(",")[0]?.trim() ?? "";
  if (!first || first === SYSTEM_PREFERENCE) return SYSTEM_PREFERENCE;
  return matchSupportedLanguage(first, android)?.tag ?? SYSTEM_PREFERENCE;
}

/**
 * Whether a raw stored or native value is already exactly the form `normalized` is persisted in.
 *
 * An unsupported tag reads as `"system"` but is not that, so choosing "System default" must
 * still write the reset: `""` or `"system"` for the system preference, the tag itself otherwise.
 */
export function isCanonicalPreference(
  raw: string,
  normalized: LanguagePreference,
): boolean {
  return normalized === SYSTEM_PREFERENCE
    ? raw === "" || raw === SYSTEM_PREFERENCE
    : raw === normalized;
}

/** The language's own name for a supported tag, or the tag itself when it is not listed. */
export function languageLabel(tag: string, android: boolean): string {
  return matchSupportedLanguage(tag, android)?.label ?? tag;
}

export interface LanguageMigrationInput {
  /** Whether `languageMigrated` is already `"1"`. */
  readonly migrated: boolean;
  /** The preference currently in effect on this device. */
  readonly currentPreference: LanguagePreference;
  /**
   * Whether finance setup is complete. A fresh install has no legacy language to preserve:
   * `settings.locale` there is only a guess from the device, so nothing is pinned.
   */
  readonly onboardingComplete: boolean;
  /** `settings.locale`, the language this app used to display before it followed the device. */
  readonly legacyLocale: string;
  readonly deviceLocales: readonly string[];
  readonly android: boolean;
}

/**
 * The preference to write so that nobody's language flips when the app starts following the
 * device, or `null` to leave it alone.
 *
 * Only for an onboarded user, and only when the legacy language differs from what `"system"` now resolves to is an explicit
 * preference needed. An explicit choice already made on this device is never overwritten.
 */
export function decideLanguageMigration(
  input: LanguageMigrationInput,
): "he-IL" | "en-US" | null {
  if (
    input.migrated ||
    !input.onboardingComplete ||
    input.currentPreference !== SYSTEM_PREFERENCE
  )
    return null;
  const legacy = languageFromLocale(input.legacyLocale);
  const system = languageFromLocale(
    resolveSystemLocale(input.deviceLocales, input.android),
  );
  if (legacy === system) return null;
  return legacy === "he" ? "he-IL" : "en-US";
}
