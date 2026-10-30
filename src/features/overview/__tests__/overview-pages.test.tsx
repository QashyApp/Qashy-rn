import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import type { ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { DEFAULT_OVERVIEW_LAYOUT } from "@/domain/overview-layout";
import { OverviewScreen } from "@/features/overview/overview-screen";

// The setup's Reanimated mock hands out an animated ref that is not callable, which the page's
// callback ref needs (the real one is a function with a `current`).
jest.mock("react-native-reanimated", () => {
  const Reanimated = jest.requireActual("react-native-reanimated/mock");
  Reanimated.default.call = () => {};
  Reanimated.useReducedMotion = Reanimated.useReducedMotion ?? (() => false);
  Reanimated.useAnimatedRef = () => Object.assign(() => {}, { current: null });
  return Reanimated;
});

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useScrollToTop: jest.fn(),
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

jest.mock("@/services/haptics", () => ({
  hapticImpactLight: jest.fn(),
  hapticSelection: jest.fn(),
}));

// Previous, current and next month side by side, as the sliding pager mounts them. Each page sits
// in a view named for its month; a slide item shows up as a view named for its order.
jest.mock("@/components/ui/month-pager", () => {
  const { View } = jest.requireActual("react-native");
  const { moveMonth } = jest.requireActual("@/utils/date");
  return {
    MonthPager: ({
      month,
      disabled,
      renderPage,
    }: {
      month: string;
      disabled?: boolean;
      renderPage: (month: string, state: { isCurrent: boolean }) => ReactNode;
    }) => (
      <View testID="pager">
        {disabled ? null : (
          <View testID={`page-${moveMonth(month, -1)}`}>
            {renderPage(moveMonth(month, -1), { isCurrent: false })}
          </View>
        )}
        <View testID={`page-${month}`}>
          {renderPage(month, { isCurrent: true })}
        </View>
        {disabled ? null : (
          <View testID={`page-${moveMonth(month, 1)}`}>
            {renderPage(moveMonth(month, 1), { isCurrent: false })}
          </View>
        )}
      </View>
    ),
    MonthSlideItem: ({
      order,
      children,
    }: {
      order: number;
      children: ReactNode;
    }) => <View testID={`slide-${order}`}>{children}</View>,
    PAGER_SCROLLER_STYLE: undefined,
    navigateMonth: jest.fn(),
    restingPosition: () => 0,
  };
});

jest.mock("@/components/ui/month-switcher", () => {
  const { View } = jest.requireActual("react-native");
  return { MonthSwitcher: () => <View testID="month-switcher" /> };
});

jest.mock("@/components/ui/page-heading", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    PageHeading: ({ title }: { title: string }) => <Text>{title}</Text>,
  };
});

jest.mock("@/features/overview/layout/use-overview-layout", () => {
  const { DEFAULT_OVERVIEW_LAYOUT: layout } = jest.requireActual(
    "@/domain/overview-layout",
  );
  const state = { layout, status: "ready", dispatch: jest.fn() };
  return { useOverviewLayout: () => state };
});

jest.mock("@/features/overview/widgets/use-dashboard", () => {
  const summary = {
    netWorthMinor: 123400,
    incomeMinor: 0,
    expenseMinor: 0,
    netFlowMinor: 0,
    dailySpend: [],
    missingExchangeRates: [],
  };
  return { useDashboard: () => summary };
});

jest.mock("@/providers/finance-provider", () => ({
  useFinanceState: () => ({ settings: { baseCurrency: "USD" } }),
}));

jest.mock("@/providers/exchange-rate-provider", () => ({
  useExchangeRateService: () => ({ ensureRatesForPending: jest.fn() }),
  useExchangeRateStatus: () => ({ enabled: true, lastError: null }),
}));

// The Coming up card's deferred actions need the finance providers; the screen only hosts them.
jest.mock("@/features/overview/widgets/upcoming-actions", () => {
  const { createContext } = jest.requireActual("react");
  return {
    UpcomingActionsContext: createContext(null),
    useUpcomingRowActions: () => ({
      actions: {
        hiddenIds: new Set(),
        paidIds: new Set(),
        resolve: jest.fn(),
      },
      pending: [],
      undo: jest.fn(),
    }),
  };
});

jest.mock("@/features/shared/use-automatic-rates", () => ({
  useTurnOnAutomaticRates: () => ({ turningOn: false, turnOn: jest.fn() }),
}));

// Every card is a plain text, so the page's own structure is what is under test.
jest.mock("@/features/overview/widgets/registry", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    WIDGET_REGISTRY: new Proxy(
      {},
      {
        get: (_target, type: string) => ({
          type,
          title: type,
          Component: ({
            card,
            month,
          }: {
            card: { id: string };
            month: string;
          }) => <Text>{`${card.id} ${month}`}</Text>,
        }),
      },
    ),
  };
});

const CARD_COUNT = DEFAULT_OVERVIEW_LAYOUT.cards.length;

function slideOrders(page: ReturnType<typeof screen.getByTestId>) {
  return within(page)
    .queryAllByTestId(/^slide-/)
    .map((node) => Number(String(node.props.testID).slice("slide-".length)));
}

describe("the Overview screen's pinned header", () => {
  it("renders the heading, Customize and the month switcher once, outside the pages", async () => {
    await render(
      <GestureHandlerRootView>
        <OverviewScreen />
      </GestureHandlerRootView>,
    );
    const pager = screen.getByTestId("pager");

    expect(screen.getAllByText("Overview")).toHaveLength(1);
    expect(screen.getAllByTestId("month-switcher")).toHaveLength(1);
    expect(screen.getAllByLabelText("Customize")).toHaveLength(1);
    expect(within(pager).queryByText("Overview")).toBeNull();
    expect(within(pager).queryByTestId("month-switcher")).toBeNull();
    expect(within(pager).queryByLabelText("Customize")).toBeNull();
    // Three month pages were rendered, so the header is not part of any of them.
    expect(within(pager).getAllByText(/^default-insight /)).toHaveLength(3);
  });

  it("swaps Customize for Done and keeps the header while editing", async () => {
    await render(
      <GestureHandlerRootView>
        <OverviewScreen />
      </GestureHandlerRootView>,
    );
    await fireEvent.press(screen.getByLabelText("Customize"));

    expect(screen.getAllByLabelText("Done")).toHaveLength(1);
    expect(screen.queryByLabelText("Customize")).toBeNull();
    expect(screen.getAllByTestId("month-switcher")).toHaveLength(1);
    // The pager is disabled while editing: only the current page is left.
    expect(screen.getAllByTestId(/^page-/)).toHaveLength(1);
    // Edit-mode frames are not slide items: only the hero still is.
    expect(screen.queryAllByTestId(/^slide-/)).toHaveLength(1);

    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Done"));
    });
    expect(screen.getAllByLabelText("Customize")).toHaveLength(1);
  });
});

describe("a month page", () => {
  it("wraps the hero and every card in a slide item, from the top down", async () => {
    await render(
      <GestureHandlerRootView>
        <OverviewScreen />
      </GestureHandlerRootView>,
    );
    const pages = screen.getAllByTestId(/^page-/);
    expect(pages).toHaveLength(3);

    for (const page of pages) {
      const orders = slideOrders(page);
      // The hero first, then one item per card, each lower down than the one above.
      expect(orders).toHaveLength(1 + CARD_COUNT);
      expect(orders[0]).toBe(0);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});
