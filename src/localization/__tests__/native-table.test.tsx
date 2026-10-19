import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import runtime from "@/localization/android-runtime.json";
import { appLanguageFromLocale } from "@/localization/language-preference";
import {
  LocalizationProvider,
  translateCurrent,
  translateMessage,
  useLocalization,
} from "@/localization/localization";
import { clearNativeTables } from "@/localization/native-table";
import { resourceName } from "@/localization/resource-names";

// A Play-translated language list, which `languages.json` does not have yet.
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

// `process.env.EXPO_OS` is inlined at compile time, so the platform is switched here instead.
const mockPlatform = { android: true };
jest.mock("@/localization/language-preference", () => ({
  ...jest.requireActual("@/localization/language-preference"),
  isAndroid: () => mockPlatform.android,
}));

const mockStore = { native: null as string | null, stored: "system" };
jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ setDisplayLocale: jest.fn() }),
  useFinanceSettings: () => ({ locale: "en-US", onboardingComplete: true }),
}));
jest.mock("@/localization/language-store", () => ({
  readNativeRawPreference: () => mockStore.native,
  usesNativeLocale: () => mockStore.native !== null,
  readDeviceLocales: () => ["en-GB"],
  loadStoredRawPreference: async () => mockStore.stored,
  persistPreference: async (preference: string) => {
    // The Android per-app locale is the stored value, so a write is read back.
    if (mockStore.native !== null) mockStore.native = preference;
  },
  migrateLegacyLanguage: async () => null,
}));

const mockGetStrings = jest.fn<
  Promise<(string | null)[]>,
  [readonly string[], string]
>();
jest.mock("../../../modules/qashy-locale", () => ({
  isAvailable: () => true,
  getStrings: (names: readonly string[], tag: string) =>
    mockGetStrings(names, tag),
}));

const PATTERN_MESSAGE = "Add an exchange rate for EUR → ILS to save.";
const PATTERN_SOURCE = "^Add an exchange rate for (.+) → (.+) to save\\.$";
const patternName = (source: string) =>
  runtime.patterns.find((entry) => entry.source === source)?.name ?? "missing";

/** What the "resources" of each locale hold, by resource name. */
const resources: Record<string, Record<string, string>> = {
  "fr-FR": {
    [resourceName("Language")]: "Langue",
    [resourceName("Overview")]: "Aperçu",
    // Reversed argument order, as a translator may need.
    [patternName(PATTERN_SOURCE)]: "Ajoutez %2$s puis %1$s pour enregistrer.",
  },
  "de-DE": {
    [resourceName("Language")]: "Sprache",
    [patternName(PATTERN_SOURCE)]: "Kurs %1$s nach %2$s hinzufügen.",
  },
};

let latest: ReturnType<typeof useLocalization> | null = null;
function Probe() {
  const value = useLocalization();
  useEffect(() => {
    latest = value;
  }, [value]);
  return <Text>{`${value.locale}|${value.language}|${value.isRtl}`}</Text>;
}

const renderProvider = () =>
  render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );

beforeEach(() => {
  clearNativeTables();
  mockPlatform.android = true;
  mockStore.native = "fr-FR";
  mockStore.stored = "system";
  latest = null;
  mockGetStrings.mockReset();
  mockGetStrings.mockImplementation(async (names, tag) =>
    names.map((name) => resources[tag]?.[name] ?? null),
  );
});

describe("Play-translated languages on Android", () => {
  it("loads once with one getStrings call, names from static strings and patterns", async () => {
    await renderProvider();
    await waitFor(() =>
      expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy(),
    );
    expect(mockGetStrings).toHaveBeenCalledTimes(1);
    const [names, tag] = mockGetStrings.mock.calls[0];
    expect(tag).toBe("fr-FR");
    expect(names).toContain(resourceName("Language"));
    expect(names).toContain(patternName(PATTERN_SOURCE));
    expect(names).toHaveLength(new Set(names).size);
  });

  it("translates a static string, keeping surrounding whitespace", async () => {
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    expect(latest?.t("Language")).toBe("Langue");
    expect(latest?.t("  Overview ")).toBe("  Aperçu ");
    expect(translateCurrent("Language")).toBe("Langue");
  });

  it("translates a pattern with captures in the translator's order", async () => {
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    expect(latest?.t(PATTERN_MESSAGE)).toBe(
      "Ajoutez ILS puis EUR pour enregistrer.",
    );
  });

  it("falls back to English for a missing entry", async () => {
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    expect(latest?.t("Base currency")).toBe("Base currency");
    expect(latest?.t("Add an exchange rate for EUR → ILS.")).toBe(
      "Add an exchange rate for EUR → ILS.",
    );
  });

  it("falls back to English and still renders when getStrings rejects", async () => {
    mockGetStrings.mockRejectedValue(new Error("no resources"));
    await renderProvider();
    await waitFor(() =>
      expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy(),
    );
    expect(latest?.t("Language")).toBe("Language");
    expect(latest?.t(PATTERN_MESSAGE)).toBe(PATTERN_MESSAGE);
    // One retry, then English.
    expect(mockGetStrings).toHaveBeenCalledTimes(2);
  });

  it("retries a rejected read once before falling back to English", async () => {
    mockGetStrings.mockRejectedValueOnce(new Error("transient"));
    await renderProvider();
    await waitFor(() =>
      expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy(),
    );
    expect(mockGetStrings).toHaveBeenCalledTimes(2);
    expect(latest?.t("Language")).toBe("Langue");
  });

  it("renders nothing until the translations have loaded", async () => {
    let release: () => void = () => undefined;
    mockGetStrings.mockImplementation(
      (names, tag) =>
        new Promise((resolve) => {
          release = () =>
            resolve(names.map((name) => resources[tag]?.[name] ?? null));
        }),
    );
    await renderProvider();
    expect(screen.queryByText(/\|/)).toBeNull();
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy(),
    );
    expect(latest?.t("Language")).toBe("Langue");
  });

  it("never leaks a translation across languages", async () => {
    mockStore.native = null;
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    await act(async () => {
      await latest?.setPreference("fr-FR");
    });
    await waitFor(() => expect(latest?.language).toBe("fr-FR"));
    expect(latest?.t(PATTERN_MESSAGE)).toBe(
      "Ajoutez ILS puis EUR pour enregistrer.",
    );
    // Hebrew is a different language with its own cache entries.
    expect(translateMessage("Language", "he")).toBe("שפה");
    expect(translateMessage(PATTERN_MESSAGE, "he")).not.toBe(PATTERN_MESSAGE);

    await act(async () => {
      await latest?.setPreference("de-DE");
    });
    await waitFor(() => expect(latest?.language).toBe("de-DE"));
    expect(latest?.t("Language")).toBe("Sprache");
    expect(latest?.t(PATTERN_MESSAGE)).toBe("Kurs EUR nach ILS hinzufügen.");
    // French is untouched by German, and Overview exists only in French.
    expect(translateMessage("Overview", "fr-FR")).toBe("Aperçu");
    expect(translateMessage("Overview", "de-DE")).toBe("Overview");

    await act(async () => {
      await latest?.setPreference("en-US");
    });
    await waitFor(() => expect(latest?.language).toBe("en"));
    expect(latest?.t("Language")).toBe("Language");
  });
});

/** getStrings calls the test settles by hand, in any order. */
function controlledLoads() {
  const calls: { tag: string; settle: (value: string) => void }[] = [];
  mockGetStrings.mockImplementation(
    (names, tag) =>
      new Promise((resolve) => {
        calls.push({
          tag,
          // Every name resolves to the given text for "Language", nothing else.
          settle: (value) =>
            resolve(
              names.map((name) =>
                name === resourceName("Language") ? value : null,
              ),
            ),
        });
      }),
  );
  return calls;
}

describe("loading translations", () => {
  it("ends on the last locale's table when loads settle out of order", async () => {
    mockStore.native = null;
    const calls = controlledLoads();
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    for (const tag of ["fr-FR", "de-DE", "fr-FR"]) {
      await act(async () => {
        await latest?.setPreference(tag);
      });
    }
    await waitFor(() => expect(calls).toHaveLength(3));
    // The newest load first, then the two superseded ones.
    await act(async () => calls[2].settle("Langue newest"));
    await waitFor(() => expect(latest?.language).toBe("fr-FR"));
    await act(async () => {
      calls[0].settle("Langue oldest");
      calls[1].settle("Sprache stale");
    });
    expect(latest?.language).toBe("fr-FR");
    expect(latest?.t("Language")).toBe("Langue newest");
    // The superseded German read is a good read of German: cached for its own locale, and never
    // mixed into French.
    expect(translateMessage("Language", "de-DE")).toBe("Sprache stale");
    expect(translateMessage("Language", "fr-FR")).toBe("Langue newest");
  });

  it("caches, but does not render, a load that finishes after unmount", async () => {
    const calls = controlledLoads();
    const view = await renderProvider();
    await waitFor(() => expect(calls).toHaveLength(1));
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await view.unmount();
    await act(async () => calls[0].settle("Langue unmounted"));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    // A good read is kept for the next visit; only the state update is skipped.
    expect(translateMessage("Language", "fr-FR")).toBe("Langue unmounted");
  });

  it("keeps the previous locale's strings and direction until the new table is ready", async () => {
    mockStore.native = "he-IL";
    const calls = controlledLoads();
    await renderProvider();
    expect(screen.getByText("he-IL|he|true")).toBeTruthy();
    await act(async () => {
      await latest?.setPreference("fr-FR");
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    // Still Hebrew, right to left, while French loads.
    expect(screen.getByText("he-IL|he|true")).toBeTruthy();
    expect(latest?.t("Language")).toBe("שפה");
    expect(translateCurrent("Language")).toBe("שפה");
    await act(async () => calls[0].settle("Langue"));
    await waitFor(() =>
      expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy(),
    );
    expect(latest?.t("Language")).toBe("Langue");
    expect(translateCurrent("Language")).toBe("Langue");
  });

  it("sets translateCurrent's language during the render, before children render", async () => {
    mockStore.native = "he-IL";
    let seen = "";
    function Child() {
      seen = translateCurrent("Language");
      return null;
    }
    await render(
      <LocalizationProvider>
        <Child />
      </LocalizationProvider>,
    );
    expect(seen).toBe("שפה");
  });

  it("keys tables by the full locale tag", async () => {
    // fr-CA is not listed, so it resolves to the listed fr-FR and uses that table.
    mockStore.native = "fr-CA";
    await renderProvider();
    await waitFor(() =>
      expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy(),
    );
    expect(mockGetStrings.mock.calls[0][1]).toBe("fr-FR");
    expect(translateMessage("Language", "fr-FR")).toBe("Langue");
  });
});

describe("revisiting a Play locale", () => {
  it("keeps a loaded table: no reload, and failing reads cannot replace it with English", async () => {
    mockStore.native = null;
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    await act(async () => {
      await latest?.setPreference("fr-FR");
    });
    await waitFor(() => expect(latest?.t("Language")).toBe("Langue"));
    expect(mockGetStrings).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest?.setPreference("he-IL");
    });
    await waitFor(() => expect(latest?.language).toBe("he"));
    // Every later read would fail, but none is made.
    mockGetStrings.mockRejectedValue(new Error("gone"));
    await act(async () => {
      await latest?.setPreference("fr-FR");
    });
    await waitFor(() => expect(latest?.language).toBe("fr-FR"));
    expect(latest?.t("Language")).toBe("Langue");
    expect(mockGetStrings).toHaveBeenCalledTimes(1);
  });

  it("tries again to load a locale whose earlier reads both failed", async () => {
    mockStore.native = null;
    mockGetStrings.mockRejectedValue(new Error("gone"));
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    await act(async () => {
      await latest?.setPreference("fr-FR");
    });
    await waitFor(() => expect(latest?.language).toBe("fr-FR"));
    expect(latest?.t("Language")).toBe("Language");
    expect(mockGetStrings).toHaveBeenCalledTimes(2);

    mockGetStrings.mockImplementation(async (names, tag) =>
      names.map((name) => resources[tag]?.[name] ?? null),
    );
    await act(async () => {
      await latest?.setPreference("he-IL");
    });
    await act(async () => {
      await latest?.setPreference("fr-FR");
    });
    await waitFor(() => expect(latest?.t("Language")).toBe("Langue"));
  });
});

describe("a read that times out", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("falls back at exactly 5 s and ignores a result arriving later", async () => {
    jest.useFakeTimers();
    const calls = controlledLoads();
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await renderProvider();
    expect(calls).toHaveLength(1);
    expect(screen.queryByText(/\|/)).toBeNull();

    // Nothing happens at 4.9 s; the first attempt times out at 5 s and is retried.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4900);
    });
    expect(calls).toHaveLength(1);
    expect(screen.queryByText(/\|/)).toBeNull();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(calls).toHaveLength(2);
    expect(screen.queryByText(/\|/)).toBeNull();

    // The retry also times out at its own 5 s: English renders.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4900);
    });
    expect(screen.queryByText(/\|/)).toBeNull();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy();
    expect(latest?.t("Language")).toBe("Language");

    // Late results, from either attempt, change nothing.
    await act(async () => {
      calls[0].settle("Langue late");
      calls[1].settle("Langue later");
    });
    expect(latest?.t("Language")).toBe("Language");
    expect(translateMessage("Language", "fr-FR")).toBe("Language");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("attempts that outlive the timeout", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  async function startAndTimeOutFirst() {
    jest.useFakeTimers();
    const calls = controlledLoads();
    await renderProvider();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    // The first attempt timed out and is still pending; the retry has started.
    expect(calls).toHaveLength(2);
    expect(screen.queryByText(/\|/)).toBeNull();
    return calls;
  }

  it("uses the first attempt when it succeeds after the retry has started", async () => {
    const calls = await startAndTimeOutFirst();
    await act(async () => calls[0].settle("Langue first"));
    expect(screen.getByText("fr-FR|fr-FR|false")).toBeTruthy();
    expect(latest?.t("Language")).toBe("Langue first");
    // The retry finishing afterwards changes nothing.
    await act(async () => calls[1].settle("Langue second"));
    expect(latest?.t("Language")).toBe("Langue first");
  });

  it("uses the retry when it succeeds first", async () => {
    const calls = await startAndTimeOutFirst();
    await act(async () => calls[1].settle("Langue second"));
    expect(latest?.t("Language")).toBe("Langue second");
    await act(async () => calls[0].settle("Langue first"));
    expect(latest?.t("Language")).toBe("Langue second");
  });
});

describe("whitespace-only messages", () => {
  it("come back unchanged in every language", async () => {
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    for (const message of ["   ", "\n", " \t "]) {
      expect(translateMessage(message, "he")).toBe(message);
      expect(translateMessage(message, "fr-FR")).toBe(message);
      expect(translateMessage(message, "en")).toBe(message);
      expect(latest?.t(message)).toBe(message);
    }
  });
});

describe("bundled and unsupported languages", () => {
  it("keeps Hebrew unchanged and makes no getStrings call", async () => {
    mockStore.native = "he-IL";
    await renderProvider();
    expect(screen.getByText("he-IL|he|true")).toBeTruthy();
    expect(latest?.t("Language")).toBe("שפה");
    expect(latest?.t("Delete Rainy day fund?")).toBe(
      "למחוק את Rainy day fund?",
    );
    expect(mockGetStrings).not.toHaveBeenCalled();
  });

  it("keeps English unchanged and makes no getStrings call", async () => {
    mockStore.native = "en-US";
    await renderProvider();
    expect(screen.getByText("en-US|en|false")).toBeTruthy();
    expect(latest?.t("Language")).toBe("Language");
    expect(mockGetStrings).not.toHaveBeenCalled();
  });

  it("does not read Play translations on web, where fr-FR is not offered", async () => {
    mockPlatform.android = false;
    mockStore.native = null;
    mockStore.stored = "fr-FR";
    await renderProvider();
    await waitFor(() =>
      expect(screen.getByText("en-US|en|false")).toBeTruthy(),
    );
    expect(latest?.t("Language")).toBe("Language");
    expect(mockGetStrings).not.toHaveBeenCalled();
  });

  it("resolves a Play-translated locale to its subtag on Android only", () => {
    expect(appLanguageFromLocale("fr-FR", true)).toBe("fr-FR");
    expect(appLanguageFromLocale("fr-FR", false)).toBe("en");
    expect(appLanguageFromLocale("xx-XX", true)).toBe("en");
    expect(appLanguageFromLocale("he-IL", true)).toBe("he");
    expect(appLanguageFromLocale("en-US", true)).toBe("en");
  });

  it("never routes an unknown language to Hebrew", () => {
    expect(translateMessage("Language", "xx")).toBe("Language");
    expect(translateMessage("Delete Rainy day fund?", "xx")).toBe(
      "Delete Rainy day fund?",
    );
    expect(translateMessage("constructor", "xx")).toBe("constructor");
    expect(translateMessage("Language", "he")).toBe("שפה");
    expect(translateMessage("Language", "en")).toBe("Language");
  });
});
