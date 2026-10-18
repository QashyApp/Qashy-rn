import {
  decideLanguageMigration,
  isCanonicalPreference,
  isRtlLocale,
  languageFromLocale,
  languageLabel,
  matchSupportedLanguage,
  normalizePreference,
  resolveLocale,
  resolveSystemLocale,
  supportedLanguages,
} from "@/localization/language-preference";

describe("resolveSystemLocale", () => {
  it("maps a supported device language to its supported tag", () => {
    expect(resolveSystemLocale(["en-GB"], false)).toBe("en-US");
    expect(resolveSystemLocale(["he"], false)).toBe("he-IL");
    expect(resolveSystemLocale(["iw-IL"], false)).toBe("he-IL");
    expect(resolveSystemLocale(["he-IL", "en-US"], false)).toBe("he-IL");
  });

  it("takes the first device locale whose language is supported", () => {
    expect(resolveSystemLocale(["de-DE", "he-IL"], false)).toBe("he-IL");
  });

  it("falls back to en-US for an unsupported or empty list", () => {
    expect(resolveSystemLocale(["de-DE", "fr"], false)).toBe("en-US");
    expect(resolveSystemLocale([], false)).toBe("en-US");
    expect(resolveSystemLocale(["", "  "], true)).toBe("en-US");
  });
});

describe("resolveLocale", () => {
  it("follows the device for the system preference", () => {
    expect(resolveLocale("system", ["he"], false)).toBe("he-IL");
    expect(resolveLocale("system", ["de"], false)).toBe("en-US");
  });

  it("lets an explicit choice win over the device", () => {
    expect(resolveLocale("he-IL", ["en-GB"], false)).toBe("he-IL");
    expect(resolveLocale("en-US", ["he"], false)).toBe("en-US");
    expect(resolveLocale("he", ["en-GB"], false)).toBe("he-IL");
  });

  it("treats an unsupported explicit tag like the system preference", () => {
    expect(resolveLocale("de-DE", ["he"], false)).toBe("he-IL");
    expect(resolveLocale("de-DE", ["fr"], false)).toBe("en-US");
  });
});

describe("playTranslated languages", () => {
  it("are ignored on web and listed on Android only", () => {
    // `languages.json` ships with none yet, so both lists agree; the gate is the argument.
    expect(supportedLanguages(false).map((l) => l.tag)).toEqual([
      "en-US",
      "he-IL",
    ]);
    expect(supportedLanguages(true).length).toBeGreaterThanOrEqual(2);
    expect(matchSupportedLanguage("fr-FR", false)).toBeUndefined();
  });
});

describe("normalizePreference", () => {
  it("reads an empty or missing value as system", () => {
    expect(normalizePreference("", true)).toBe("system");
    expect(normalizePreference(undefined, false)).toBe("system");
    expect(normalizePreference(null, false)).toBe("system");
    expect(normalizePreference("system", false)).toBe("system");
  });

  it("takes the first tag of a locale list and canonicalizes it", () => {
    expect(normalizePreference("he-IL,en-US", true)).toBe("he-IL");
    expect(normalizePreference("he", true)).toBe("he-IL");
    expect(normalizePreference("en_GB", false)).toBe("en-US");
  });

  it("drops an unsupported tag", () => {
    expect(normalizePreference("fr-FR", false)).toBe("system");
  });
});

describe("languageFromLocale and RTL", () => {
  it("maps Hebrew to he and everything else to en", () => {
    expect(languageFromLocale("he-IL")).toBe("he");
    expect(languageFromLocale("iw")).toBe("he");
    expect(languageFromLocale("en-US")).toBe("en");
    expect(languageFromLocale("fr-FR")).toBe("en");
  });

  it("flags he, ar, fa, ur and yi as right to left", () => {
    for (const tag of ["he-IL", "ar", "ar-EG", "fa-IR", "ur-PK", "yi", "iw"])
      expect(isRtlLocale(tag)).toBe(true);
    for (const tag of ["en-US", "de-DE", "es", ""])
      expect(isRtlLocale(tag)).toBe(false);
  });

  it("labels a tag with the language's own name", () => {
    expect(languageLabel("he-IL", false)).toBe("עברית");
    expect(languageLabel("en-US", false)).toBe("English");
  });
});

describe("decideLanguageMigration", () => {
  const base = {
    migrated: false,
    onboardingComplete: true,
    currentPreference: "system",
    legacyLocale: "en-US",
    deviceLocales: ["en-US"],
    android: false,
  };

  it("does nothing once migrated", () => {
    expect(
      decideLanguageMigration({
        ...base,
        migrated: true,
        legacyLocale: "he-IL",
      }),
    ).toBeNull();
  });

  it("does nothing when the legacy language already matches the device", () => {
    expect(decideLanguageMigration(base)).toBeNull();
    expect(
      decideLanguageMigration({
        ...base,
        legacyLocale: "he-IL",
        deviceLocales: ["he"],
      }),
    ).toBeNull();
    // Unsupported device language resolves to English, so an English legacy needs nothing.
    expect(
      decideLanguageMigration({ ...base, deviceLocales: ["de"] }),
    ).toBeNull();
  });

  it("pins Hebrew for a Hebrew user on a non-Hebrew device", () => {
    expect(decideLanguageMigration({ ...base, legacyLocale: "he-IL" })).toBe(
      "he-IL",
    );
  });

  it("pins English for an English user on a Hebrew device", () => {
    expect(decideLanguageMigration({ ...base, deviceLocales: ["he-IL"] })).toBe(
      "en-US",
    );
  });

  it("pins English for a legacy language the app never translated", () => {
    expect(
      decideLanguageMigration({
        ...base,
        legacyLocale: "fr-FR",
        deviceLocales: ["he"],
      }),
    ).toBe("en-US");
  });

  it("never overwrites an explicit choice already made on this device", () => {
    expect(
      decideLanguageMigration({
        ...base,
        currentPreference: "en-US",
        legacyLocale: "he-IL",
      }),
    ).toBeNull();
  });

  it("pins nothing on a fresh install, whatever the device says", () => {
    expect(
      decideLanguageMigration({
        ...base,
        onboardingComplete: false,
        legacyLocale: "en-US",
        deviceLocales: ["de-DE", "he-IL"],
      }),
    ).toBeNull();
  });
});

describe("isCanonicalPreference", () => {
  it("is true only for the exact persisted form", () => {
    expect(isCanonicalPreference("", "system")).toBe(true);
    expect(isCanonicalPreference("system", "system")).toBe(true);
    expect(isCanonicalPreference("de-DE", "system")).toBe(false);
    expect(isCanonicalPreference("he-IL", "he-IL")).toBe(true);
    expect(isCanonicalPreference("he-IL,en-US", "he-IL")).toBe(false);
    expect(isCanonicalPreference("he", "he-IL")).toBe(false);
  });
});
