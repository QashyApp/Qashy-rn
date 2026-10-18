import { decideLanguageMigration } from "@/localization/language-preference";

// A Play-translated language, which `languages.json` does not have yet.
jest.mock("@/localization/languages.json", () => ({
  bundled: [
    { tag: "en-US", label: "English" },
    { tag: "he-IL", label: "עברית" },
  ],
  playTranslated: [{ tag: "fr-FR", label: "Français" }],
}));

describe("decideLanguageMigration with a Play-translated language", () => {
  const base = {
    migrated: false,
    onboardingComplete: true,
    currentPreference: "system",
    legacyLocale: "en-US",
    deviceLocales: ["fr-CA"],
    android: true,
  };

  it("pins English for an onboarded English user whose device now resolves to French", () => {
    expect(decideLanguageMigration(base)).toBe("en-US");
  });

  it("pins Hebrew for a Hebrew user on a French device", () => {
    expect(decideLanguageMigration({ ...base, legacyLocale: "he-IL" })).toBe(
      "he-IL",
    );
  });

  it("pins English for a legacy fr-FR, which the old app displayed in English", () => {
    expect(decideLanguageMigration({ ...base, legacyLocale: "fr-FR" })).toBe(
      "en-US",
    );
  });

  it("pins nothing when the device language is not offered, as on web", () => {
    expect(decideLanguageMigration({ ...base, android: false })).toBeNull();
  });

  it("pins nothing for a fresh install", () => {
    expect(
      decideLanguageMigration({ ...base, onboardingComplete: false }),
    ).toBeNull();
  });
});
