import { act, render, renderHook, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { initialSettings } from "@/domain/defaults";
import { WelcomeStep } from "@/features/onboarding/steps/welcome-step";
import { useOnboardingFlow } from "@/features/onboarding/use-onboarding-flow";
import {
  LocalizationProvider,
  useLocalization,
} from "@/localization/localization";
import { showError } from "@/utils/confirm";

const mockCompleteOnboarding = jest.fn();
const mockRepository = {
  setDisplayLocale: jest.fn(),
  completeOnboarding: (...args: unknown[]) => mockCompleteOnboarding(...args),
  updateSettings: jest.fn(async () => undefined),
};
const mockSettings = initialSettings();
/** Android's per-app locale: a write that succeeds is what native then reports. */
const applyNative = async (preference: string): Promise<void> => {
  mockStore.native = preference === "system" ? "" : preference;
};
const mockStore = {
  native: "",
  persist: applyNative,
};

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("@/utils/confirm", () => ({
  showError: jest.fn(),
  errorMessage: (reason: unknown, fallback: string) =>
    reason instanceof Error ? reason.message : fallback,
}));
jest.mock("@/utils/haptics", () => ({ hapticSuccess: jest.fn() }));
jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => mockRepository,
  useFinanceSettings: () => mockSettings,
  useFinanceState: () => ({ settings: mockSettings }),
}));
// Android's per-app locale is read synchronously, so the provider is loaded on first render.
jest.mock("@/localization/language-store", () => ({
  readNativeRawPreference: () => mockStore.native,
  usesNativeLocale: () => true,
  readDeviceLocales: () => ["en-US"],
  loadStoredRawPreference: async () => "system",
  persistPreference: (preference: string) => mockStore.persist(preference),
  migrateLegacyLanguage: async () => null,
}));
// WelcomeStep: only its use of the localization context is under test, not the chrome.
jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({ space: new Proxy({}, { get: () => 8 }) }),
}));
jest.mock("@/components/ui/motion", () => ({
  MotionView: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/components/ui/app-text", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return { AppText: NativeText };
});
jest.mock("@/features/onboarding/steps/welcome-hero", () => ({
  WelcomeHero: () => null,
}));
jest.mock("@/components/ui/language-selector", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return {
    LanguageSelector: ({ value }: { value: string }) => (
      <NativeText>{`selector:${value}`}</NativeText>
    ),
  };
});

function deferred() {
  let settle: (error?: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve());
  });
  return { promise, settle };
}

/** A language tap, then lets the provider's (possibly failing) write and its handlers settle. */
const tap = async (setLocale: (locale: string) => void, locale: string) => {
  await act(async () => {
    setLocale(locale);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <LocalizationProvider>{children}</LocalizationProvider>
);
const mountFlow = () =>
  renderHook(
    () => ({ flow: useOnboardingFlow(), localization: useLocalization() }),
    { wrapper },
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.native = "";
  mockStore.persist = applyNative;
  mockCompleteOnboarding.mockResolvedValue(undefined);
});

describe("useOnboardingFlow language", () => {
  it("starts in the language the UI shows, with the suggested names in it", async () => {
    const { result } = await mountFlow();
    expect(result.current.flow.draft.locale).toBe("en-US");
    expect(result.current.flow.draft.accountName).toBe("Everyday");
  });

  it("follows the provider live, and the suggested name follows the language", async () => {
    const { result } = await mountFlow();
    await tap(result.current.flow.setLocale, "he-IL");
    expect(result.current.localization.locale).toBe("he-IL");
    expect(result.current.flow.draft.locale).toBe("he-IL");
    expect(result.current.flow.draft.accountName).toBe("יומיומי");
  });

  it("stays consistent with the provider after two failed taps", async () => {
    const { result } = await mountFlow();
    mockStore.persist = async () => {
      throw new Error("disk full");
    };
    await tap(result.current.flow.setLocale, "he-IL");
    await tap(result.current.flow.setLocale, "he-IL");
    expect(showError).toHaveBeenCalledTimes(2);
    expect(result.current.localization.locale).toBe("en-US");
    expect(result.current.flow.draft.locale).toBe("en-US");
    expect(result.current.flow.draft.accountName).toBe("Everyday");
  });

  it("stays consistent when overlapping taps both fail", async () => {
    const { result } = await mountFlow();
    const first = deferred();
    const second = deferred();
    const gates = [first, second];
    mockStore.persist = () => gates.shift()!.promise;
    await act(async () => {
      result.current.flow.setLocale("he-IL");
    });
    // Pending, so the UI is optimistic: the draft says Hebrew too, and its name follows.
    expect(result.current.localization.locale).toBe("he-IL");
    expect(result.current.flow.draft.locale).toBe("he-IL");
    expect(result.current.flow.draft.accountName).toBe("יומיומי");
    await act(async () => {
      result.current.flow.setLocale("en-US");
    });
    expect(result.current.localization.locale).toBe("en-US");
    expect(result.current.flow.draft.locale).toBe("en-US");
    await act(async () => first.settle(new Error("a")));
    await act(async () => second.settle(new Error("b")));
    expect(result.current.localization.locale).toBe("en-US");
    expect(result.current.flow.draft.locale).toBe("en-US");
    expect(result.current.flow.draft.accountName).toBe("Everyday");
  });

  it("keeps a name the user typed through language changes, including a rolled-back one", async () => {
    const { result } = await mountFlow();
    await act(async () =>
      result.current.flow.update({ accountName: "Rainy day" }),
    );
    await tap(result.current.flow.setLocale, "he-IL");
    expect(result.current.flow.draft.accountName).toBe("Rainy day");
    mockStore.persist = async () => {
      throw new Error("nope");
    };
    await tap(result.current.flow.setLocale, "en-US");
    expect(result.current.flow.draft.accountName).toBe("Rainy day");
  });

  it("finishes with the opening balance parsed in, and the locale taken from, the current UI locale", async () => {
    const { result } = await mountFlow();
    await act(async () =>
      result.current.flow.update({ openingBalance: "1,234.50" }),
    );
    await tap(result.current.flow.setLocale, "he-IL");
    // Hebrew uses the same separators as English, so the figure stays valid after the switch.
    expect(result.current.flow.errors.openingBalance).toBeUndefined();
    await act(async () => {
      await result.current.flow.finish();
    });
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockCompleteOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "he-IL",
        openingBalanceMinor: 123_450,
        accountName: "יומיומי",
      }),
    );
  });

  it("sends en-US and a typed name when a failed language tap was rolled back", async () => {
    const { result } = await mountFlow();
    await act(async () =>
      result.current.flow.update({ accountName: "Rainy day" }),
    );
    mockStore.persist = async () => {
      throw new Error("nope");
    };
    await tap(result.current.flow.setLocale, "he-IL");
    await act(async () => {
      await result.current.flow.finish();
    });
    expect(mockCompleteOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en-US", accountName: "Rainy day" }),
    );
  });
});

describe("WelcomeStep", () => {
  function Harness() {
    const { setPreference } = useLocalization();
    return (
      <>
        <WelcomeStep onLocale={() => undefined} />
        <Text onPress={() => void setPreference("he-IL")}>switch</Text>
      </>
    );
  }

  it("shows the locale the provider reports, and follows it", async () => {
    await render(
      <LocalizationProvider>
        <Harness />
      </LocalizationProvider>,
    );
    expect(screen.getByText("selector:en-US")).toBeTruthy();
    await act(async () => {
      screen.getByText("switch").props.onPress();
    });
    expect(screen.getByText("selector:he-IL")).toBeTruthy();
  });
});
