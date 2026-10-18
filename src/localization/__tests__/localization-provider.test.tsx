import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { AppState, Text } from "react-native";

import {
  LocalizationProvider,
  translateCurrent,
  useLocalization,
} from "@/localization/localization";

const mockSetDisplayLocale = jest.fn();
const mockStore = {
  native: null as string | null,
  stored: "system",
  deviceLocales: ["en-GB"],
  persisted: [] as string[],
  persist: async (preference: string): Promise<void> => {
    mockStore.persisted.push(preference);
  },
  load: async (): Promise<string> => mockStore.stored,
  readDeviceLocales: jest.fn(),
  migrate: async (_input: unknown): Promise<string | null> => null,
};

jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ setDisplayLocale: mockSetDisplayLocale }),
  useFinanceSettings: () => ({ locale: "en-US", onboardingComplete: true }),
}));

jest.mock("@/localization/language-store", () => ({
  readNativeRawPreference: () => mockStore.native,
  usesNativeLocale: () => mockStore.native !== null,
  readDeviceLocales: () => mockStore.readDeviceLocales(),
  loadStoredRawPreference: () => mockStore.load(),
  persistPreference: (preference: string) => mockStore.persist(preference),
  migrateLegacyLanguage: (input: unknown) => mockStore.migrate(input),
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

const renderProvider = () =>
  render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );

/** A persist call whose outcome the test decides. */
function deferred() {
  let settle: (error?: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve());
  });
  return { promise, settle };
}

beforeEach(() => {
  mockSetDisplayLocale.mockReset();
  mockStore.native = null;
  mockStore.stored = "system";
  mockStore.deviceLocales = ["en-GB"];
  mockStore.persisted = [];
  mockStore.persist = async (preference) => {
    mockStore.persisted.push(preference);
  };
  mockStore.load = async () => mockStore.stored;
  mockStore.migrate = async () => null;
  mockStore.readDeviceLocales.mockReset();
  mockStore.readDeviceLocales.mockImplementation(() => mockStore.deviceLocales);
  latest = null;
});

describe("LocalizationProvider", () => {
  it("renders nothing until the stored preference has loaded, then follows the device", async () => {
    mockStore.deviceLocales = ["he"];
    const load = deferred();
    mockStore.load = async () => {
      await load.promise;
      return mockStore.stored;
    };
    await renderProvider();
    // Nothing is rendered, and the repository has not been told the placeholder locale.
    expect(screen.queryByText(/\|/)).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSetDisplayLocale).not.toHaveBeenCalled();
    await act(async () => load.settle());
    await waitFor(() =>
      expect(screen.getByText("system|he-IL|true|he")).toBeTruthy(),
    );
    expect(mockSetDisplayLocale).toHaveBeenCalledTimes(1);
    expect(mockSetDisplayLocale).toHaveBeenCalledWith("he-IL");
  });

  it("reads Android's per-app locale synchronously on the first render", async () => {
    mockStore.native = "he-IL";
    mockStore.deviceLocales = ["en-US"];
    await renderProvider();
    expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();
  });

  it("switches live, persists, and tells the repository", async () => {
    await renderProvider();
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
    // `translateCurrent` flips in the same commit as the UI.
    expect(translateCurrent("Language")).toBe("שפה");
  });

  it("reverts and rejects when the write fails", async () => {
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    mockStore.persist = async () => {
      throw new Error("x");
    };
    await act(async () => {
      await expect(latest?.setPreference("he-IL")).rejects.toThrow("x");
    });
    expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
  });

  it("rolls back to the newest successful write after an older and a newer one both succeeded", async () => {
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    const outcomes = [undefined, undefined, new Error("newest failed")];
    mockStore.persist = async () => {
      const outcome = outcomes.shift();
      if (outcome) throw outcome;
    };
    await act(async () => {
      await latest!.setPreference("he-IL");
    });
    await act(async () => {
      await latest!.setPreference("en-US");
    });
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
    await act(async () => {
      await expect(latest!.setPreference("he-IL")).rejects.toThrow(
        "newest failed",
      );
    });
    // Not "system" (the initial value) and not Hebrew (the older success): the newer success.
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
  });

  describe("overlapping choices", () => {
    const start = async () => {
      await renderProvider();
      await waitFor(() => expect(latest).not.toBeNull());
    };
    const choose = async (preference: string) => {
      let promise: Promise<void> = Promise.resolve();
      await act(async () => {
        promise = latest!.setPreference(preference);
        promise.catch(() => undefined);
      });
      return { promise };
    };

    it("rolls back only when the failing request is still the newest", async () => {
      await start();
      const first = deferred();
      mockStore.persist = (preference) => {
        mockStore.persisted.push(preference);
        return mockStore.persisted.length === 1
          ? first.promise
          : Promise.resolve();
      };
      const { promise: hebrew } = await choose("he-IL");
      await choose("en-US");
      expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
      // The failed Hebrew choice was superseded by English, which applied: no error to show.
      await act(async () => {
        first.settle(new Error("late"));
        await expect(hebrew).resolves.toBeUndefined();
      });
      expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
      expect(mockStore.persisted).toEqual(["he-IL", "en-US"]);
    });

    it("rejects both calls when the same choice is made twice and the write fails", async () => {
      await start();
      const write = deferred();
      mockStore.persist = () => write.promise;
      const { promise: first } = await choose("he-IL");
      const { promise: second } = await choose("he-IL");
      expect(second).toBe(first);
      await act(async () => {
        write.settle(new Error("x"));
        await expect(first).rejects.toThrow("x");
        await expect(second).rejects.toThrow("x");
      });
      expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
    });

    it("shows the native value, not the stored one, once the queue drains after a failure", async () => {
      mockStore.native = "";
      await start();
      mockStore.persist = async () => {
        // The user changed the language in system Settings while this write was failing.
        mockStore.native = "he-IL";
        throw new Error("x");
      };
      await act(async () => {
        await expect(latest!.setPreference("en-US")).rejects.toThrow("x");
      });
      expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();
    });

    it("rolls the newest failure back to the last persisted value, not the one before the tap", async () => {
      await start();
      const older = deferred();
      const newest = deferred();
      const gates = [older, newest];
      mockStore.persist = () => gates.shift()!.promise;
      const { promise: first } = await choose("he-IL");
      const { promise: second } = await choose("en-US");
      await act(async () => {
        older.settle();
        await first;
      });
      await act(async () => {
        newest.settle(new Error("newest failed"));
        await expect(second).rejects.toThrow("newest failed");
      });
      // Hebrew was persisted by the older request, so that is what the UI must show.
      expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();
    });

    it("runs writes one at a time, in the order they were chosen", async () => {
      await start();
      const first = deferred();
      const started: string[] = [];
      mockStore.persist = (preference) => {
        started.push(preference);
        return started.length === 1 ? first.promise : Promise.resolve();
      };
      const { promise: a } = await choose("he-IL");
      const { promise: b } = await choose("en-US");
      // The UI is optimistic, but the second write has not started behind the first.
      expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
      expect(started).toEqual(["he-IL"]);
      await act(async () => {
        first.settle();
        await Promise.all([a, b]);
      });
      expect(started).toEqual(["he-IL", "en-US"]);
      expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
    });

    it("ends on the last persisted value when two overlapping writes both fail", async () => {
      await start();
      const a = deferred();
      const b = deferred();
      const gates = [a, b];
      mockStore.persist = () => gates.shift()!.promise;
      const { promise: first } = await choose("he-IL");
      const { promise: second } = await choose("en-US");
      await act(async () => {
        a.settle(new Error("a"));
        await expect(first).resolves.toBeUndefined();
      });
      expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
      await act(async () => {
        b.settle(new Error("b"));
        await expect(second).rejects.toThrow("b");
      });
      expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
    });
  });

  describe("an unsupported stored value", () => {
    it("is reset on web when System default is chosen", async () => {
      mockStore.stored = "de-DE";
      await renderProvider();
      await waitFor(() =>
        expect(screen.getByText("system|en-US|false|en")).toBeTruthy(),
      );
      await act(async () => {
        await latest?.setPreference("system");
      });
      expect(mockStore.persisted).toEqual(["system"]);
      // Now it is canonical, so choosing it again writes nothing.
      await act(async () => {
        await latest?.setPreference("system");
      });
      expect(mockStore.persisted).toEqual(["system"]);
    });

    it("is reset on Android when System default is chosen", async () => {
      mockStore.native = "de-DE";
      await renderProvider();
      expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
      await act(async () => {
        await latest?.setPreference("system");
      });
      expect(mockStore.persisted).toEqual(["system"]);
    });

    it("does not write anything for a genuine system preference", async () => {
      mockStore.native = "";
      await renderProvider();
      await act(async () => {
        await latest?.setPreference("system");
      });
      expect(mockStore.persisted).toEqual([]);
    });
  });

  describe("Android per-app language changes in system Settings", () => {
    it("re-reads the native value when the app becomes active, and unsubscribes on unmount", async () => {
      let listener: (state: string) => void = () => undefined;
      const remove = jest.fn();
      const spy = jest
        .spyOn(AppState, "addEventListener")
        .mockImplementation((_type, handler) => {
          listener = handler as (state: string) => void;
          return { remove } as unknown as ReturnType<
            typeof AppState.addEventListener
          >;
        });
      mockStore.native = "";
      mockStore.deviceLocales = ["en-US"];
      const view = await renderProvider();
      expect(screen.getByText("system|en-US|false|en")).toBeTruthy();

      mockStore.native = "he-IL";
      await act(async () => listener("background"));
      expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
      await act(async () => listener("active"));
      expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();

      mockStore.deviceLocales = ["he-IL"];
      mockStore.native = "";
      await act(async () => listener("active"));
      expect(screen.getByText("system|he-IL|true|he")).toBeTruthy();

      expect(remove).not.toHaveBeenCalled();
      await view.unmount();
      expect(remove).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  it("skips an app resume while a write is pending, then re-reads the native value once it settles", async () => {
    let listener: (state: string) => void = () => undefined;
    const spy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, handler) => {
        listener = handler as (state: string) => void;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    mockStore.native = "";
    mockStore.deviceLocales = ["en-US"];
    await renderProvider();
    const write = deferred();
    mockStore.persist = () => write.promise;
    let promise: Promise<void> = Promise.resolve();
    await act(async () => {
      promise = latest!.setPreference("he-IL");
    });
    // Resume mid-write: the native value is still the old one and must not win.
    await act(async () => listener("active"));
    expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();
    // The user then changes it in system Settings before the write settles.
    mockStore.native = "en-US";
    await act(async () => {
      write.settle();
      await promise;
    });
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
    expect(mockSetDisplayLocale).toHaveBeenLastCalledWith("en-US");
    spy.mockRestore();
  });

  it("shows what is persisted when a write fails behind a queued resume re-read", async () => {
    let listener: (state: string) => void = () => undefined;
    const spy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, handler) => {
        listener = handler as (state: string) => void;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    mockStore.native = "";
    mockStore.deviceLocales = ["en-US"];
    await renderProvider();
    const write = deferred();
    mockStore.persist = () => write.promise;
    let promise: Promise<void> = Promise.resolve();
    await act(async () => {
      promise = latest!.setPreference("he-IL");
      promise.catch(() => undefined);
    });
    // The re-read queues behind the write, then finds native unchanged: it shows nothing itself.
    await act(async () => listener("active"));
    await act(async () => {
      write.settle(new Error("x"));
      await expect(promise).rejects.toThrow("x");
    });
    expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
    expect(mockSetDisplayLocale).toHaveBeenLastCalledWith("en-US");
    spy.mockRestore();
  });

  it("shows what is persisted when a choice made behind a no-op migration fails", async () => {
    const migration = deferred();
    mockStore.migrate = async () => {
      await migration.promise;
      return null;
    };
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    mockStore.persist = async () => {
      throw new Error("x");
    };
    let promise: Promise<void> = Promise.resolve();
    await act(async () => {
      promise = latest!.setPreference("he-IL");
      promise.catch(() => undefined);
    });
    expect(screen.getByText("he-IL|he-IL|true|he")).toBeTruthy();
    await act(async () => {
      migration.settle();
      await expect(promise).rejects.toThrow("x");
    });
    expect(screen.getByText("system|en-US|false|en")).toBeTruthy();
  });

  it("runs the migration before a choice made while it is in flight, and that choice stays the rollback target", async () => {
    const migration = deferred();
    mockStore.migrate = async () => {
      await migration.promise;
      return "he-IL";
    };
    await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    // The user picks English while the migration is still running.
    let choice: Promise<void> = Promise.resolve();
    await act(async () => {
      choice = latest!.setPreference("en-US");
    });
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
    await act(async () => {
      migration.settle();
      await choice;
    });
    // The migration's Hebrew never replaced the choice on screen...
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
    // ...nor the value a later failure falls back to.
    mockStore.persist = async () => {
      throw new Error("x");
    };
    await act(async () => {
      await expect(latest!.setPreference("he-IL")).rejects.toThrow("x");
    });
    expect(screen.getByText("en-US|en-US|false|en")).toBeTruthy();
  });

  it("sets no state after unmount when a write that was in flight then rejects", async () => {
    const react = jest.requireActual<typeof import("react")>("react");
    let unmounted = false;
    let setsAfterUnmount = 0;
    const realUseState = react.useState;
    const spy = jest.spyOn(react, "useState").mockImplementation(((
      initial: unknown,
    ) => {
      const [value, set] = realUseState(initial);
      const wrapped = (next: unknown) => {
        if (unmounted) setsAfterUnmount++;
        (set as (value: unknown) => void)(next);
      };
      return [value, wrapped];
    }) as typeof react.useState);
    const view = await renderProvider();
    await waitFor(() => expect(latest).not.toBeNull());
    const write = deferred();
    mockStore.persist = () => write.promise;
    let promise: Promise<void> = Promise.resolve();
    await act(async () => {
      promise = latest!.setPreference("he-IL");
      promise.catch(() => undefined);
    });
    await view.unmount();
    unmounted = true;
    await act(async () => {
      write.settle(new Error("late"));
      await expect(promise).rejects.toThrow("late");
    });
    expect(setsAfterUnmount).toBe(0);
    spy.mockRestore();
  });

  it("does not touch state when unmounted during the async load", async () => {
    const load = deferred();
    let resolveRaw: (raw: string) => void = () => undefined;
    mockStore.load = () =>
      new Promise<string>((resolve) => {
        resolveRaw = resolve;
      });
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = await renderProvider();
    const readsBefore = mockStore.readDeviceLocales.mock.calls.length;
    await view.unmount();
    await act(async () => {
      resolveRaw("he-IL");
      load.settle();
      await load.promise;
    });
    // The device locales are read only when the load is still wanted.
    expect(mockStore.readDeviceLocales.mock.calls.length).toBe(readsBefore);
    expect(mockSetDisplayLocale).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
