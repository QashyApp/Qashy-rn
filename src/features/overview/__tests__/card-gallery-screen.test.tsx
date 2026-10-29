import { act, fireEvent, render, screen } from "@testing-library/react-native";

import {
  DEFAULT_OVERVIEW_LAYOUT,
  type OverviewLayout,
} from "@/domain/overview-layout";
import { CardGalleryScreen } from "@/features/overview/card-gallery-screen";
import { router } from "expo-router";
import { showError } from "@/utils/confirm";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));

jest.mock("@/utils/confirm", () => ({
  confirmDestructive: jest.fn(),
  errorMessage: (_reason: unknown, fallback: string) => fallback,
  showError: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.mock("@/services/haptics", () => ({ hapticSelection: jest.fn() }));

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
  }),
}));

// The store has its own tests; the gallery only needs a hook it can steer. A tiny external store
// stands in so a layout change re-renders the screen, as the real store's publish does.
interface MockHookState {
  layout: OverviewLayout;
  status: "loading" | "unavailable" | "ready";
}
const mockLayoutHook: {
  state: MockHookState;
  listeners: Set<() => void>;
  set: (next: Partial<MockHookState>) => void;
  dispatch: jest.Mock;
} = {
  state: { layout: DEFAULT_OVERVIEW_LAYOUT, status: "ready" },
  listeners: new Set<() => void>(),
  set(next) {
    mockLayoutHook.state = { ...mockLayoutHook.state, ...next };
    mockLayoutHook.listeners.forEach((listener) => listener());
  },
  dispatch: jest.fn(),
};
jest.mock("@/features/overview/layout/use-overview-layout", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  return {
    useOverviewLayout: () => ({
      ...useSyncExternalStore(
        (listener: () => void) => {
          mockLayoutHook.listeners.add(listener);
          return () => mockLayoutHook.listeners.delete(listener);
        },
        () => mockLayoutHook.state,
      ),
      dispatch: mockLayoutHook.dispatch,
    }),
  };
});

const withGoals: OverviewLayout = {
  ...DEFAULT_OVERVIEW_LAYOUT,
  cards: [
    ...DEFAULT_OVERVIEW_LAYOUT.cards,
    { id: "g", type: "goals", size: "regular", config: {} },
  ],
};

const addGoals = () => screen.getByLabelText("Add Goals card");

describe("CardGalleryScreen add", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLayoutHook.state = {
      layout: DEFAULT_OVERVIEW_LAYOUT,
      status: "ready",
    };
  });

  it("ignores a second tap while an add is in flight", async () => {
    let resolveAdd: (changed: boolean) => void = () => {};
    mockLayoutHook.dispatch.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveAdd = resolve;
      }),
    );
    await render(<CardGalleryScreen />);

    await fireEvent.press(addGoals());
    await fireEvent.press(addGoals());
    await fireEvent.press(screen.getByLabelText("Add Top categories card"));
    expect(mockLayoutHook.dispatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockLayoutHook.set({ layout: withGoals });
      resolveAdd(true);
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/overview");
    expect(showError).not.toHaveBeenCalled();
  });

  it("goes back without an error when the card is already on the overview", async () => {
    mockLayoutHook.dispatch.mockImplementation(async () => {
      // Another path added it first; this add changed nothing.
      await act(async () => mockLayoutHook.set({ layout: withGoals }));
      return false;
    });
    await render(<CardGalleryScreen />);
    await fireEvent.press(addGoals());
    await act(async () => {});
    expect(router.replace).toHaveBeenCalledWith("/overview");
    expect(showError).not.toHaveBeenCalled();
  });

  it("keeps the error when nothing was saved and the card is not there", async () => {
    mockLayoutHook.dispatch.mockResolvedValue(false);
    await render(<CardGalleryScreen />);
    await fireEvent.press(addGoals());
    await act(async () => {});
    expect(router.replace).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(1);
  });

  it("shows the error on a failed save and accepts another tap afterwards", async () => {
    mockLayoutHook.dispatch.mockRejectedValueOnce(new Error("disk full"));
    mockLayoutHook.dispatch.mockResolvedValueOnce(true);
    await render(<CardGalleryScreen />);
    await fireEvent.press(addGoals());
    await act(async () => {});
    expect(showError).toHaveBeenCalledTimes(1);

    await fireEvent.press(addGoals());
    await act(async () => {});
    expect(mockLayoutHook.dispatch).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it("offers nothing while the saved layout is unavailable", async () => {
    mockLayoutHook.set({ status: "unavailable" });
    await render(<CardGalleryScreen />);
    expect(screen.queryByLabelText("Add Goals card")).toBeNull();
    expect(screen.queryByText("Reset to default layout")).toBeNull();
  });
});
