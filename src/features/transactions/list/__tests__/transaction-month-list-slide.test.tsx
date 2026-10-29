import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { TransactionRecord } from "@/domain/models";
import {
  TransactionMonthList,
  type TransactionMonthListProps,
} from "@/features/transactions/list/transaction-month-list";

// The gestures need a native root; the ledger's grouping is what is under test.
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy(() => chain, { get: () => () => chain });
  return {
    Gesture: { Simultaneous: () => chain, Pan: () => chain, Tap: () => chain },
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  };
});

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
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

jest.mock("@/components/finance/transaction-row", () => {
  const { View: Host } = jest.requireActual("react-native");
  return { TransactionRow: () => <Host /> };
});

// The pager's per-item hook, reduced to a marker that records its order.
jest.mock("@/components/ui/month-pager", () => {
  const { View: Host } = jest.requireActual("react-native");
  return {
    PAGER_SCROLLER_STYLE: {},
    MonthSlideItem: ({
      order,
      children,
    }: {
      order: number;
      children: ReactNode;
    }) => (
      <Host testID="slide" accessibilityLabel={String(order)}>
        {children}
      </Host>
    ),
  };
});

function tx(id: string, localDate: string, status = "posted") {
  return {
    id,
    localDate,
    status,
    kind: "expense",
  } as unknown as TransactionRecord;
}

const mockTransactions = [
  tx("u1", "2026-10-30", "upcoming"),
  tx("a1", "2026-10-20"),
  tx("a2", "2026-10-20"),
  tx("b1", "2026-10-10"),
  tx("c1", "2026-10-01"),
  tx("c2", "2026-10-01"),
];

jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ queryTransactions: () => mockTransactions }),
  useFinanceState: () => ({ transactions: mockTransactions, categories: [] }),
}));

const noop = jest.fn();
const props: TransactionMonthListProps = {
  month: "2026-10-01",
  isCurrent: true,
  search: "",
  kind: "all",
  allMonths: false,
  selectionMode: false,
  selectedIds: new Set(),
  hiddenIds: new Set(),
  paidIds: new Set(),
  latestMonth: null,
  content: {},
  upcomingCollapsed: false,
  onToggleUpcoming: noop,
  onToggleSelectionMode: noop,
  onToggleItem: noop,
  onSetSelection: noop,
  onLongPressItem: noop,
  onRowAction: noop,
  onClearFilters: noop,
  onGoToMonth: noop,
};

const orders = () =>
  screen
    .getAllByTestId("slide", { includeHiddenElements: true })
    .map((node) => Number(node.props.accessibilityLabel));

describe("TransactionMonthList month slide", () => {
  it("gives a day's header and rows one order, increasing down the month", async () => {
    await render(<TransactionMonthList {...props} />);
    // Upcoming (header + 1 row), Oct 20 (header + 2), Oct 10 (header + 1 row, the first screen
    // the list renders ends here).
    expect(orders()).toEqual([0, 0, 1, 1, 1, 2, 2]);
  });

  it("numbers the first day 0 when there is no upcoming group", async () => {
    await render(<TransactionMonthList {...props} kind="expense" />);
    // Oct 30 (header + 1), Oct 20 (header + 2), Oct 10 (header + 1).
    expect(orders()).toEqual([0, 0, 1, 1, 1, 2, 2]);
  });
});
