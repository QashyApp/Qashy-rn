import { act, render } from "@testing-library/react-native";
import { AppState } from "react-native";

import {
  WIDGET_REFRESH_RETRY_DELAYS_MS,
  WIDGET_REFRESH_WINDOW_MS,
  WidgetRefresher,
} from "@/features/widgets/widget-refresher";

const mockRefresh = jest.fn(async () => true);
const mockRequestPreviews = jest.fn();
const mockRegisterPreviews = jest.fn(async () => "registered");
const mockRepositoryListeners = new Set<() => void>();
const mockSettingsListeners = new Set<() => void>();
const mockThemeListeners = new Set<() => void>();
let mockAvailable = true;

jest.mock("@/features/widgets/refresher", () => ({
  refreshWidgets: () => mockRefresh(),
}));
jest.mock("@/data/local-finance-repository", () => ({
  financeRepository: {
    subscribe: (listener: () => void) => {
      mockRepositoryListeners.add(listener);
      return () => mockRepositoryListeners.delete(listener);
    },
  },
}));
jest.mock("@/data/widget-settings-store", () => ({
  subscribeWidgetSettings: (listener: () => void) => {
    mockSettingsListeners.add(listener);
    return () => mockSettingsListeners.delete(listener);
  },
}));
jest.mock("@/theme/custom/use-custom-themes", () => ({
  customThemesStore: {
    subscribe: (listener: () => void) => {
      mockThemeListeners.add(listener);
      return () => mockThemeListeners.delete(listener);
    },
  },
}));
jest.mock("@/features/widgets/preview-registration", () => ({
  requestPreviewRegistration: (register: () => Promise<unknown>) => {
    mockRequestPreviews();
    void register();
  },
}));
jest.mock("../../../../modules/qashy-widgets", () => ({
  isAvailable: () => mockAvailable,
  registerPreviews: () => mockRegisterPreviews(),
}));

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const fire = (listeners: Set<() => void>) => {
  for (const listener of listeners) listener();
};

describe("<WidgetRefresher />", () => {
  let appStateListener: (state: string) => void;
  beforeEach(() => {
    jest.useFakeTimers();
    mockRequestPreviews.mockClear();
    mockRegisterPreviews.mockClear();
    mockRefresh.mockReset();
    mockRefresh.mockResolvedValue(true);
    mockAvailable = true;
    appStateListener = () => {};
    // The Jest React Native setup stubs AppState without a subscription to remove.
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _: string,
      listener: (state: string) => void,
    ) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** Mounts and lets the mount refresh's window close, so the next event is a quiet-period one. */
  const mountSettled = async () => {
    const view = await render(<WidgetRefresher />);
    await advance(WIDGET_REFRESH_WINDOW_MS);
    mockRefresh.mockClear();
    return view;
  };

  it("renders nothing and refreshes on mount", async () => {
    const view = await render(<WidgetRefresher />);
    expect(view.toJSON()).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the first event of a quiet period at once", async () => {
    await mountSettled();
    fire(mockRepositoryListeners);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("folds a burst into the leading refresh plus one trailing refresh", async () => {
    await mountSettled();
    for (const listener of mockRepositoryListeners) {
      listener();
      listener();
      listener();
    }
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await advance(WIDGET_REFRESH_WINDOW_MS - 1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await advance(WIDGET_REFRESH_WINDOW_MS * 4);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes on settings and custom theme changes", async () => {
    await mountSettled();
    fire(mockSettingsListeners);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await advance(WIDGET_REFRESH_WINDOW_MS);
    fire(mockThemeListeners);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes when the app becomes active, and not when it goes to the background", async () => {
    await mountSettled();
    appStateListener("background");
    expect(mockRefresh).not.toHaveBeenCalled();
    appStateListener("active");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending trailing refresh when the app leaves the foreground", async () => {
    await mountSettled();
    fire(mockRepositoryListeners);
    fire(mockRepositoryListeners);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    appStateListener("background");
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await advance(WIDGET_REFRESH_WINDOW_MS * 4);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("retries a refresh that did not complete, then gives up", async () => {
    mockRefresh.mockResolvedValue(false);
    await render(<WidgetRefresher />);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    let expected = 1;
    for (const delay of WIDGET_REFRESH_RETRY_DELAYS_MS) {
      await advance(delay);
      expected += 1;
      expect(mockRefresh).toHaveBeenCalledTimes(expected);
    }
    await advance(120_000);
    expect(mockRefresh).toHaveBeenCalledTimes(expected);
  });

  it("stops retrying once a refresh completes", async () => {
    mockRefresh.mockResolvedValueOnce(false);
    await render(<WidgetRefresher />);
    await advance(WIDGET_REFRESH_RETRY_DELAYS_MS[0]);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await advance(120_000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("cleans up on unmount", async () => {
    const view = await mountSettled();
    fire(mockRepositoryListeners);
    fire(mockRepositoryListeners);
    mockRefresh.mockClear();
    await view.unmount();
    expect(mockRepositoryListeners.size).toBe(0);
    expect(mockSettingsListeners.size).toBe(0);
    expect(mockThemeListeners.size).toBe(0);
    await advance(WIDGET_REFRESH_WINDOW_MS * 2);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does nothing without the native module", async () => {
    mockAvailable = false;
    await render(<WidgetRefresher />);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockRepositoryListeners.size).toBe(0);
  });

  it("asks for the picker previews on mount", async () => {
    await render(<WidgetRefresher />);
    expect(mockRequestPreviews).toHaveBeenCalledTimes(1);
    expect(mockRegisterPreviews).toHaveBeenCalledTimes(1);
  });

  it("does not ask for previews without the native module", async () => {
    mockAvailable = false;
    await render(<WidgetRefresher />);
    expect(mockRequestPreviews).not.toHaveBeenCalled();
  });
});
