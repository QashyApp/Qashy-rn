import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { BackHandler, Text } from "react-native";

import { HoldToCustomize } from "@/features/overview/card-stack-motion";
import { OverviewScreen } from "@/features/overview/overview-screen";
import { hapticImpactLight } from "@/services/haptics";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useScrollToTop: jest.fn(),
  // The screen is always focused here.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(effect, [effect]);
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

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

jest.mock("@/components/finance/animated-money", () => ({
  CountUpSubject: ({ children }: { children: ReactNode }) => children,
}));

// The pager's swipe machinery needs the finance provider; here it only has to render the page.
jest.mock("@/components/ui/month-pager", () => ({
  MonthPager: ({
    month,
    renderPage,
  }: {
    month: string;
    renderPage: (month: string, state: { isCurrent: boolean }) => ReactNode;
  }) => renderPage(month, { isCurrent: true }),
  navigateMonth: jest.fn(),
  restingPosition: () => 0,
}));

jest.mock("@/services/haptics", () => ({
  hapticImpactLight: jest.fn(),
  hapticSelection: jest.fn(),
}));

jest.mock("@/features/overview/layout/use-overview-layout", () => {
  const { DEFAULT_OVERVIEW_LAYOUT: layout } = jest.requireActual(
    "@/domain/overview-layout",
  );
  const state = { layout, status: "ready", dispatch: jest.fn() };
  return { useOverviewLayout: () => state };
});

// The month page is big and has its own concerns; this stub offers the hold into edit mode the
// real page does, wired to the same `onEnterEdit`. The Customize button belongs to the screen's
// own pinned header, so the real one is under test.
jest.mock("@/features/overview/overview-month-page", () => {
  const { Text: T, View: V } = jest.requireActual("react-native");
  const { HoldToCustomize: Hold } = jest.requireActual(
    "@/features/overview/card-stack-motion",
  );
  return {
    OverviewMonthPage: ({
      editing,
      onEnterEdit,
    }: {
      editing: boolean;
      onEnterEdit: () => void;
    }) => (
      <V>
        <T testID="editing">{editing ? "yes" : "no"}</T>
        <Hold onActivate={onEnterEdit}>
          <T>card</T>
        </Hold>
      </V>
    ),
  };
});

describe("entering edit mode", () => {
  beforeEach(() => jest.clearAllMocks());

  it("gives exactly one haptic when a card is held", async () => {
    await render(<OverviewScreen />);
    await fireEvent(screen.getByText("card"), "longPress");
    expect(screen.getByTestId("editing")).toHaveTextContent("yes");
    expect(hapticImpactLight).toHaveBeenCalledTimes(1);
  });

  it("gives exactly one haptic from the Customize button", async () => {
    await render(<OverviewScreen />);
    await fireEvent.press(screen.getByLabelText("Customize"));
    expect(screen.getByTestId("editing")).toHaveTextContent("yes");
    expect(hapticImpactLight).toHaveBeenCalledTimes(1);
  });
});

describe("leaving edit mode with the back button", () => {
  it("exits edit mode instead of leaving the screen", async () => {
    const remove = jest.fn();
    const add = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation(() => ({ remove }));
    await render(<OverviewScreen />);
    expect(add).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Customize"));
    expect(screen.getByTestId("editing")).toHaveTextContent("yes");
    const handler = add.mock.calls.at(-1)?.[1] as () => boolean;

    let consumed = false;
    await act(async () => {
      consumed = handler();
    });
    expect(consumed).toBe(true);
    expect(screen.getByTestId("editing")).toHaveTextContent("no");
    expect(remove).toHaveBeenCalled();
    add.mockRestore();
  });
});

describe("HoldToCustomize", () => {
  it("activates on a hold without a haptic of its own", async () => {
    jest.clearAllMocks();
    const onActivate = jest.fn();
    await render(
      <HoldToCustomize onActivate={onActivate}>
        <Text>card</Text>
      </HoldToCustomize>,
    );
    await fireEvent(screen.getByText("card"), "longPress");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(hapticImpactLight).not.toHaveBeenCalled();
  });
});
