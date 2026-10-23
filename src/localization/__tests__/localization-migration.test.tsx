import { act, render, screen, waitFor } from "@testing-library/react-native";

import { readLanguagePreference } from "@/data/device-local/language-preference-store";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import { SYNC_META, writeMeta } from "@/data/sync-store";
import {
  LocalizationProvider,
  useLocalization,
} from "@/localization/localization";
import { useEffect } from "react";
import { Text } from "react-native";

// The real `migrateLegacyLanguage` and store run here; only the storage singleton, the
// repository and the native module are replaced.
const mockEnv = {
  adapter: null as unknown as MemoryStorageAdapter,
  settings: { locale: "he-IL", onboardingComplete: true },
  deviceLocales: ["en-US"],
  /** Makes every storage transaction reject, as a full disk or a locked database would. */
  failStorage: false,
  native: {
    available: false,
    applied: "",
    /** Holds a write of this tag until the test lets it through. */
    hold: null as { tag: string; release: Promise<void> } | null,
  },
};

jest.mock("@/data/local-finance-repository", () => ({
  syncingStorage: {
    transact: (
      work: Parameters<MemoryStorageAdapter["transact"]>[0],
      options?: Parameters<MemoryStorageAdapter["transact"]>[1],
    ) =>
      mockEnv.failStorage
        ? Promise.reject(new Error("storage unavailable"))
        : mockEnv.adapter.transact(work, options),
  },
}));
jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ setDisplayLocale: jest.fn() }),
  useFinanceSettings: () => mockEnv.settings,
}));
jest.mock("expo-localization", () => ({
  getLocales: () =>
    mockEnv.deviceLocales.map((languageTag) => ({ languageTag })),
}));
jest.mock("../../../modules/qashy-locale", () => ({
  isAvailable: () => mockEnv.native.available,
  getApplicationLocales: () => mockEnv.native.applied,
  setApplicationLocales: async (tags: string) => {
    if (mockEnv.native.hold?.tag === tags) await mockEnv.native.hold.release;
    mockEnv.native.applied = tags;
  },
  getSystemLocales: () => [],
}));

function Probe() {
  const { preference, locale } = useLocalization();
  return <Text>{`${preference}|${locale}`}</Text>;
}

const mount = () =>
  render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );
const stored = () =>
  mockEnv.adapter.transact((tx) => readLanguagePreference(tx));
const migratedFlag = async () =>
  (
    await mockEnv.adapter.transact(async (tx) =>
      tx.table("syncMeta").getMany([SYNC_META.languageMigrated]),
    )
  )[0]?.value;

beforeEach(async () => {
  mockEnv.adapter = new MemoryStorageAdapter();
  await mockEnv.adapter.initialize();
  mockEnv.settings = { locale: "he-IL", onboardingComplete: true };
  mockEnv.deviceLocales = ["en-US"];
  mockEnv.native = { available: false, applied: "", hold: null };
  mockEnv.failStorage = false;
});

describe("legacy language migration in the provider", () => {
  it("runs once: a Hebrew user on an English device keeps Hebrew, and a re-mount does not run it again", async () => {
    const first = await mount();
    await waitFor(() => expect(screen.getByText("he-IL|he-IL")).toBeTruthy());
    await waitFor(async () => expect(await migratedFlag()).toBe("1"));
    expect(await stored()).toBe("he-IL");
    await first.unmount();

    // The user switches back to following the device; a re-mount must not pin Hebrew again.
    await act(async () => {
      await mockEnv.adapter.transact((tx) =>
        writeMeta(tx, { [SYNC_META.appLanguage]: "system" }),
      );
    });
    await mount();
    await waitFor(() => expect(screen.getByText("system|en-US")).toBeTruthy());
    await act(async () => {
      await Promise.resolve();
    });
    expect(await stored()).toBe("system");
    expect(screen.getByText("system|en-US")).toBeTruthy();
  });

  it("pins nothing on a fresh install, but still records that it ran", async () => {
    mockEnv.settings = { locale: "en-US", onboardingComplete: false };
    mockEnv.deviceLocales = ["de-DE", "he-IL"];
    await mount();
    await waitFor(() => expect(screen.getByText("system|he-IL")).toBeTruthy());
    await waitFor(async () => expect(await migratedFlag()).toBe("1"));
    expect(await stored()).toBe("system");
    expect(screen.getByText("system|he-IL")).toBeTruthy();
  });

  it("leaves the preference unpinned when onboarding completes after the migration already ran", async () => {
    mockEnv.settings = { locale: "en-US", onboardingComplete: false };
    mockEnv.deviceLocales = ["en-US"];
    const view = await mount();
    await waitFor(async () => expect(await migratedFlag()).toBe("1"));
    expect(await stored()).toBe("system");

    // Onboarding finishes. It no longer writes `settings.locale`, but even a leftover Hebrew
    // value there must not be read as a legacy choice now: the migration is one-time.
    mockEnv.settings = { locale: "he-IL", onboardingComplete: true };
    await act(async () => {
      view.rerender(
        <LocalizationProvider>
          <Probe />
        </LocalizationProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(await stored()).toBe("system");
    expect(screen.getByText("system|en-US")).toBeTruthy();

    // Nor does the next launch pin it.
    await view.unmount();
    await mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(await stored()).toBe("system");
    expect(screen.getByText("system|en-US")).toBeTruthy();
  });

  it("shows the device language when the migration write fails, and retries on the next launch", async () => {
    mockEnv.failStorage = true;
    const view = await mount();
    // A Hebrew user on an English device: the write failed, so this session follows the device.
    await waitFor(() => expect(screen.getByText("system|en-US")).toBeTruthy());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("system|en-US")).toBeTruthy();
    mockEnv.failStorage = false;
    expect(await stored()).toBe("system");
    expect(await migratedFlag()).toBeUndefined();
    await view.unmount();

    // The next launch runs the migration again, and this time it lands.
    await mount();
    await waitFor(async () => expect(await migratedFlag()).toBe("1"));
    expect(await stored()).toBe("he-IL");
    expect(screen.getByText("he-IL|he-IL")).toBeTruthy();
  });

  it("ends on system when the user picks English, then System default, while the migration is writing", async () => {
    // Android with the native module. A Hebrew user on an English device: the migration pins Hebrew.
    mockEnv.native.available = true;
    let release: () => void = () => undefined;
    mockEnv.native.hold = {
      tag: "he-IL",
      release: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    let tap: ReturnType<typeof useLocalization>["setPreference"] = async () =>
      undefined;
    function Capture() {
      const { setPreference } = useLocalization();
      useEffect(() => {
        tap = setPreference;
      }, [setPreference]);
      return <Probe />;
    }
    await render(
      <LocalizationProvider>
        <Capture />
      </LocalizationProvider>,
    );
    // The migration is now stuck writing Hebrew. Two more choices queue behind it.
    let both: Promise<unknown> = Promise.resolve();
    await act(async () => {
      both = Promise.all([tap("en-US"), tap("system")]);
    });
    expect(screen.getByText("system|en-US")).toBeTruthy();
    expect(mockEnv.native.applied).toBe("");
    await act(async () => {
      release();
      await both;
    });
    expect(screen.getByText("system|en-US")).toBeTruthy();
    expect(mockEnv.native.applied).toBe("");
    expect(await stored()).toBe("system");
    expect(await migratedFlag()).toBe("1");
  });
});
