import { fireEvent, render, screen } from "@testing-library/react-native";

import { LanguageScreen } from "@/features/more/language-screen";
import {
  resolveLocale,
  resolveSystemLocale,
  supportedLanguages,
} from "@/localization/language-preference";

// A non-empty playTranslated list, which `languages.json` does not have yet.
jest.mock("@/localization/languages.json", () => ({
  bundled: [
    { tag: "en-US", label: "English" },
    { tag: "he-IL", label: "עברית" },
  ],
  playTranslated: [
    { tag: "de-DE", label: "Deutsch" },
    { tag: "pt-BR", label: "Português (Brasil)" },
  ],
}));

const mockSetPreference = jest.fn();
// `process.env.EXPO_OS` is inlined at compile time, so the platform is switched here instead.
const mockPlatform = { android: true };

jest.mock("@/localization/language-preference", () => ({
  ...jest.requireActual("@/localization/language-preference"),
  isAndroid: () => mockPlatform.android,
}));

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});
jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
    preference: "system",
    systemLocale: "en-US",
    setPreference: mockSetPreference,
  }),
}));

describe("playTranslated languages", () => {
  it("are supported on Android only", () => {
    expect(supportedLanguages(true).map((option) => option.tag)).toEqual([
      "en-US",
      "he-IL",
      "de-DE",
      "pt-BR",
    ]);
    expect(supportedLanguages(false).map((option) => option.tag)).toEqual([
      "en-US",
      "he-IL",
    ]);
  });

  it("resolve from the device list on Android and are ignored on web", () => {
    expect(resolveSystemLocale(["de-AT"], true)).toBe("de-DE");
    expect(resolveSystemLocale(["de-AT"], false)).toBe("en-US");
    expect(resolveLocale("pt-BR", ["he"], true)).toBe("pt-BR");
    expect(resolveLocale("pt-BR", ["he"], false)).toBe("he-IL");
  });
});

describe("LanguageScreen with Play-translated languages", () => {
  afterEach(() => {
    mockPlatform.android = true;
    mockSetPreference.mockReset();
  });

  it("lists system default, bundled, then Play-translated languages on Android", async () => {
    mockPlatform.android = true;
    await render(<LanguageScreen />);
    expect(
      screen
        .getAllByRole("radio")
        .map((radio) => radio.props.accessibilityLabel),
    ).toEqual([
      "System default, English",
      "English",
      "עברית",
      "Deutsch",
      "Português (Brasil)",
    ]);
    mockSetPreference.mockResolvedValue(undefined);
    await fireEvent.press(screen.getByRole("radio", { name: "Deutsch" }));
    expect(mockSetPreference).toHaveBeenCalledWith("de-DE");
  });

  it("lists only the bundled languages on web", async () => {
    mockPlatform.android = false;
    await render(<LanguageScreen />);
    expect(
      screen
        .getAllByRole("radio")
        .map((radio) => radio.props.accessibilityLabel),
    ).toEqual(["System default, English", "English", "עברית"]);
  });
});
