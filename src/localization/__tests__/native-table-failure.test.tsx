import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import {
  LocalizationProvider,
  useLocalization,
} from "@/localization/localization";
import {
  clearNativeTables,
  EMPTY_NATIVE_TABLE,
  getNativeTable,
  NATIVE_LOAD_TIMEOUT_MS,
  withTimeout,
} from "@/localization/native-table";
import { resourceName } from "@/localization/resource-names";

jest.mock("@/localization/languages.json", () => ({
  bundled: [
    { tag: "en-US", label: "English" },
    { tag: "he-IL", label: "עברית" },
  ],
  playTranslated: [{ tag: "fr-FR", label: "Français" }],
}));

jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ setDisplayLocale: jest.fn() }),
  useFinanceSettings: () => ({ locale: "en-US", onboardingComplete: true }),
}));
jest.mock("@/localization/language-store", () => ({
  readNativeRawPreference: () => "fr-FR",
  usesNativeLocale: () => true,
  readDeviceLocales: () => ["en-GB"],
  loadStoredRawPreference: async () => "fr-FR",
  persistPreference: async () => undefined,
  migrateLegacyLanguage: async () => null,
}));

// The native module itself is mocked, so the real `getStrings` wrapper runs.
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

function Probe() {
  const { t } = useLocalization();
  return <Text>{`ready:${t("Language")}`}</Text>;
}
const renderProvider = () =>
  render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );

const french = (names: string[]) =>
  names.map((name) => (name === resourceName("Language") ? "Langue" : null));

beforeEach(clearNativeTables);

afterEach(() => {
  jest.useRealTimers();
  mockNativeGetStrings.mockReset();
});

describe("a failing native read", () => {
  it("retries once when the native module rejects", async () => {
    mockNativeGetStrings.mockRejectedValueOnce(new Error("resources busy"));
    mockNativeGetStrings.mockImplementation(async (names) => french(names));
    await renderProvider();
    await waitFor(() => expect(screen.getByText("ready:Langue")).toBeTruthy());
    expect(mockNativeGetStrings).toHaveBeenCalledTimes(2);
  });

  it("falls back to English after the retry also fails, and renders", async () => {
    mockNativeGetStrings.mockRejectedValue(new Error("gone"));
    await renderProvider();
    await waitFor(() =>
      expect(screen.getByText("ready:Language")).toBeTruthy(),
    );
    expect(mockNativeGetStrings).toHaveBeenCalledTimes(2);
  });
});

describe("a native read that finds no translations", () => {
  it("counts as a failure: retried once, English meanwhile, and tried again on a later visit", async () => {
    mockNativeGetStrings.mockImplementation(async (names) =>
      names.map(() => null),
    );
    await renderProvider();
    await waitFor(() =>
      expect(screen.getByText("ready:Language")).toBeTruthy(),
    );
    expect(mockNativeGetStrings).toHaveBeenCalledTimes(2);
    // Not installed as a good table: nothing is cached for the locale.
    expect(getNativeTable("fr-FR")).toBe(EMPTY_NATIVE_TABLE);
  });
});

describe("a native read that never settles", () => {
  it("times out, retries once, then renders English", async () => {
    jest.useFakeTimers();
    mockNativeGetStrings.mockReturnValue(new Promise(() => undefined));
    await renderProvider();
    // Nothing is shown while the first attempt is pending.
    expect(screen.queryByText(/ready:/)).toBeNull();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(NATIVE_LOAD_TIMEOUT_MS - 1);
    });
    expect(screen.queryByText(/ready:/)).toBeNull();
    expect(mockNativeGetStrings).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(mockNativeGetStrings).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/ready:/)).toBeNull();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(NATIVE_LOAD_TIMEOUT_MS);
    });
    expect(screen.getByText("ready:Language")).toBeTruthy();
  });

  it("uses a slow attempt that finishes in time, and clears its timer", async () => {
    jest.useFakeTimers();
    mockNativeGetStrings.mockImplementation(
      (names) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(french(names)), 3000),
        ),
    );
    await renderProvider();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("ready:Langue")).toBeTruthy();
    expect(mockNativeGetStrings).toHaveBeenCalledTimes(1);
    // The timeout never fires later, whether or not other timers exist.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(NATIVE_LOAD_TIMEOUT_MS * 2);
    });
    expect(screen.getByText("ready:Langue")).toBeTruthy();
    expect(mockNativeGetStrings).toHaveBeenCalledTimes(1);
  });
});

describe("withTimeout", () => {
  it("clears its timer when the load wins or fails", async () => {
    jest.useFakeTimers();
    await expect(withTimeout(Promise.resolve("ok"), 5000)).resolves.toBe("ok");
    expect(jest.getTimerCount()).toBe(0);
    await expect(
      withTimeout(Promise.reject(new Error("bad")), 5000),
    ).rejects.toThrow("bad");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("rejects when the load has not settled in time", async () => {
    jest.useFakeTimers();
    const pending = withTimeout(new Promise<string>(() => undefined), 5000);
    const outcome = expect(pending).rejects.toThrow("Timed out");
    await jest.advanceTimersByTimeAsync(5000);
    await outcome;
  });
});
