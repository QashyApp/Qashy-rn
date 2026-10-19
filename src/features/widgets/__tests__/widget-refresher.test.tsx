import { act, render } from "@testing-library/react-native";
import { AppState } from "react-native";

import {
  WIDGET_REFRESH_DEBOUNCE_MS,
  WidgetRefresher,
} from "@/features/widgets/widget-refresher";

const mockRefresh = jest.fn(async () => undefined);
const mockRepositoryListeners = new Set<() => void>();
const mockSettingsListeners = new Set<() => void>();
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
jest.mock("../../../../modules/qashy-widgets", () => ({
  isAvailable: () => mockAvailable,
}));

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe("<WidgetRefresher />", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRefresh.mockClear();
    mockAvailable = true;
    // The Jest React Native setup stubs AppState without a subscription to remove.
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((() => ({ remove: jest.fn() })) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("renders nothing and refreshes on mount", async () => {
    const view = await render(<WidgetRefresher />);
    expect(view.toJSON()).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("debounces a burst of repository events into one refresh", async () => {
    await render(<WidgetRefresher />);
    mockRefresh.mockClear();
    for (const listener of mockRepositoryListeners) {
      listener();
      listener();
      listener();
    }
    await advance(WIDGET_REFRESH_DEBOUNCE_MS - 1);
    expect(mockRefresh).not.toHaveBeenCalled();
    await advance(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on settings changes and when the app becomes active", async () => {
    let appStateListener: (state: string) => void = () => {};
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _: string,
      listener: (state: string) => void,
    ) => {
      appStateListener = listener;
      return { remove };
    }) as never);
    await render(<WidgetRefresher />);
    mockRefresh.mockClear();

    for (const listener of mockSettingsListeners) listener();
    await advance(WIDGET_REFRESH_DEBOUNCE_MS);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    appStateListener("background");
    await advance(WIDGET_REFRESH_DEBOUNCE_MS);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    appStateListener("active");
    await advance(WIDGET_REFRESH_DEBOUNCE_MS);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("cleans up on unmount", async () => {
    const view = await render(<WidgetRefresher />);
    mockRefresh.mockClear();
    for (const listener of mockRepositoryListeners) listener();
    await view.unmount();
    expect(mockRepositoryListeners.size).toBe(0);
    expect(mockSettingsListeners.size).toBe(0);
    await advance(WIDGET_REFRESH_DEBOUNCE_MS * 2);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does nothing without the native module", async () => {
    mockAvailable = false;
    await render(<WidgetRefresher />);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockRepositoryListeners.size).toBe(0);
  });
});
