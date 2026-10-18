import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import {
  LocalizationProvider,
  useLocalization,
} from "@/localization/localization";

const mockSetDisplayLocale = jest.fn();
const mockStore = {
  native: null as string | null,
  stored: "system",
  deviceLocales: ["en-GB"],
  persisted: [] as string[],
  migrated: null as string | null,
};

jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ setDisplayLocale: mockSetDisplayLocale }),
  useFinanceSettings: () => ({ locale: "en-US" }),
}));

jest.mock("@/localization/language-store", () => ({
  readNativePreference: () => mockStore.native,
  usesNativeLocale: () => mockStore.native !== null,
  readDeviceLocales: () => mockStore.deviceLocales,
  loadStoredPreference: async () => mockStore.stored,
  persistPreference: async (preference: string) => {
    mockStore.persisted.push(preference);
  },
  migrateLegacyLanguage: async () => mockStore.migrated,
}));

let latest: ReturnType<typeof useLocalization> | null = null;

function Probe() {
  const value = useLocalization();
  useEffect(() => {
    latest = value;
  }, [value]);
  return (
    <Text>{`${value.preference}|${value.locale}|${value.isRtl}|${value.language}`}</Text>
  );
}

beforeEach(() => {
  mockSetDisplayLocale.mockReset();
  mockStore.native = null;
  mockStore.stored = "system";
  mockStore.deviceLocales = ["en-GB"];
  mockStore.persisted = [];
  mockStore.migrated = null;
  latest = null;
});

describe("LocalizationProvider", () => {
  it("renders nothing until the stored preference has loaded, then follows the device", async () => {
    mockStore.deviceLocales = ["he"];
    await render(
      <LocalizationProvider>
        <Probe />
      </LocalizationProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("system|he-IL|true|he")).toBeTruthy(),
    );
    expect(mockSetDisplayLocale).toHaveBeenCalledWith("he-IL");
  });

  it("reads Android's per-app locale synchronously on the first render", async () => {
    mockStore.native = "he-IL";
    mockStore.deviceLocales = ["en-US"];
    await render(
      <LocalizationProvider>
        <Probe />
      </LocalizationProvider>,
    );
    expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();
  });

  it("switches live, persists, and tells the repository", async () => {
    await render(
      <LocalizationProvider>
        <Probe />
      </LocalizationProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("system|en-US|false|en")).toBeTruthy(),
    );
    await act(async () => {
      await latest?.setPreference("he-IL");
    });
    expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();
    expect(mockStore.persisted).toEqual(["he-IL"]);
    expect(mockSetDisplayLocale).toHaveBeenLastCalledWith("he-IL");
    expect(latest?.t("Language")).toBe("שפה");
  });

  it("reverts and rejects when the write fails", async () => {
    await render(
      <LocalizationProvider>
        <Probe />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(latest).not.toBeNull());
    const store = jest.requireMock("@/localization/language-store");
    jest
      .spyOn(store, "persistPreference")
      .mockRejectedValueOnce(new Error("x"));
    await act(async () => {
      await expect(latest?.setPreference("he-IL")).rejects.toThrow("x");
    });
    expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
  });

  it("rolls back only when the failing request is still the newest", async () => {
    await render(
      <LocalizationProvider>
        <Probe />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(latest).not.toBeNull());
    const store = jest.requireMock("@/localization/language-store");
    let rejectFirst: (reason: Error) => void = () => undefined;
    jest.spyOn(store, "persistPreference").mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectFirst = reject;
        }),
    );
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = latest!.setPreference("he-IL");
      first.catch(() => undefined);
    });
    await act(async () => {
      await latest!.setPreference("en-US");
    });
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
    // The Hebrew write fails after English was chosen: English must stay.
    await act(async () => {
      rejectFirst(new Error("late"));
      await expect(first).rejects.toThrow("late");
    });
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
  });
});
