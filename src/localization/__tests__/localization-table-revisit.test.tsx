import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import {
  LocalizationProvider,
  useLocalization,
} from "@/localization/localization";
import { clearNativeTables } from "@/localization/native-table";
import { resourceName } from "@/localization/resource-names";

jest.mock("@/localization/languages.json", () => ({
  bundled: [
    { tag: "en-US", label: "English" },
    { tag: "he-IL", label: "עברית" },
  ],
  playTranslated: [
    { tag: "fr-FR", label: "Français" },
    { tag: "de-DE", label: "Deutsch" },
  ],
}));

jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ setDisplayLocale: jest.fn() }),
  useFinanceSettings: () => ({ locale: "en-US", onboardingComplete: true }),
}));
// The OS per-app locale: a choice lands here, and the provider re-reads it when its writes drain.
const mockOs = { locale: "de-DE" };
jest.mock("@/localization/language-store", () => ({
  readNativeRawPreference: () => mockOs.locale,
  usesNativeLocale: () => true,
  readDeviceLocales: () => ["en-GB"],
  loadStoredRawPreference: async () => "de-DE",
  persistPreference: async (preference: string) => {
    mockOs.locale = preference;
  },
  migrateLegacyLanguage: async () => null,
}));

const mockNativeGetStrings = jest.fn<
  Promise<(string | null)[]>,
  [string[], string]
>();
jest.mock("../../../modules/qashy-locale/src/QashyLocaleModule", () => ({
  __esModule: true,
  default: {
    getStrings: (names: string[], tag: string) =>
      mockNativeGetStrings(names, tag),
  },
}));

/** Every committed frame, so a one-frame flash of English cannot hide behind `waitFor`. */
const frames: string[] = [];
let frUnavailable = true;
let latest: ReturnType<typeof useLocalization> | null = null;

function Probe() {
  const value = useLocalization();
  useEffect(() => {
    latest = value;
  }, [value]);
  const text = `${value.locale}:${value.t("Language")}`;
  frames.push(text);
  return <Text>{text}</Text>;
}

const translated = (word: string) => (names: string[]) =>
  names.map((name) => (name === resourceName("Language") ? word : null));

beforeEach(() => {
  clearNativeTables();
  frames.length = 0;
  latest = null;
  frUnavailable = true;
  mockOs.locale = "de-DE";
});
afterEach(() => mockNativeGetStrings.mockReset());

describe("revisiting a locale whose earlier load failed", () => {
  it("holds the previous locale until the reload settles, never showing English first", async () => {
    // German loads. French fails both attempts. French then loads on the revisit.
    mockNativeGetStrings.mockImplementation(async (names, tag) => {
      if (tag === "de-DE") return translated("Sprache")(names);
      if (frUnavailable) throw new Error("resources busy");
      return translated("Langue")(names);
    });
    await render(
      <LocalizationProvider>
        <Probe />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText("de-DE:Sprache")).toBeTruthy());

    // fr fails: English, as the final fallback.
    await act(async () => {
      await latest!.setPreference("fr-FR");
    });
    await waitFor(() =>
      expect(screen.getByText("fr-FR:Language")).toBeTruthy(),
    );

    // Back to de (already loaded), then to fr again.
    await act(async () => {
      await latest!.setPreference("de-DE");
    });
    expect(screen.getByText("de-DE:Sprache")).toBeTruthy();
    frames.length = 0;
    frUnavailable = false;
    await act(async () => {
      await latest!.setPreference("fr-FR");
    });
    await waitFor(() => expect(screen.getByText("fr-FR:Langue")).toBeTruthy());

    // The revisit went straight from German to French: no frame in English.
    expect(frames).not.toContain("fr-FR:Language");
    expect(frames).not.toContain("en-US:Language");
    expect(frames[0]).toBe("de-DE:Sprache");
  });

  it("keeps a table that finished loading after its effect was cancelled", async () => {
    // French is left mid-load and revisited. The first read then succeeds, while the revisit's
    // own reads (the attempt and its retry) fail: the late success must still be what shows.
    const pending: {
      resolve: (values: (string | null)[]) => void;
      reject: (reason: Error) => void;
      names: string[];
    }[] = [];
    mockNativeGetStrings.mockImplementation((names, tag) => {
      if (tag === "de-DE") return Promise.resolve(translated("Sprache")(names));
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject, names }),
      );
    });
    await render(
      <LocalizationProvider>
        <Probe />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText("de-DE:Sprache")).toBeTruthy());

    // Leave German for French (load 1 starts and hangs), then go back and return to French.
    await act(async () => {
      await latest!.setPreference("fr-FR");
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      await latest!.setPreference("de-DE");
    });
    await act(async () => {
      await latest!.setPreference("fr-FR");
    });
    // The revisit's load 2 starts a fresh read.
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));

    // Load 1 succeeds, but its effect was cancelled when the user left French.
    await act(async () => {
      pending[0].resolve(translated("Langue")(pending[0].names));
    });
    // Load 2 fails on its attempt and again on its retry.
    await act(async () => {
      pending[1].reject(new Error("resources busy"));
    });
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(3));
    await act(async () => {
      pending[2].reject(new Error("resources busy"));
    });

    await waitFor(() => expect(screen.getByText("fr-FR:Langue")).toBeTruthy());
    expect(screen.queryByText("fr-FR:Language")).toBeNull();
  });
});
