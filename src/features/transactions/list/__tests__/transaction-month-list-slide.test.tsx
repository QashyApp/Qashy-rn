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

// What the repository answers, and the queries it was asked.
let mockRows: TransactionRecord[] = mockTransactions;
const mockQuery = jest.fn((..._args: unknown[]) => mockRows);

jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => ({ queryTransactions: mockQuery }),
  useFinanceState: () => ({
    transactions: mockTransactions,
    categories: [],
    accounts: [],
    tags: [],
  }),
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

describe("TransactionMonthList scope", () => {
  beforeEach(() => {
    mockRows = mockTransactions;
    mockQuery.mockClear();
  });

  it("asks for the month's range, but not for Upcoming or a search across months", async () => {
    await render(<TransactionMonthList {...props} />);
    expect(mockQuery.mock.calls.at(-1)?.[0]).toMatchObject({
      fromDate: "2026-10-01",
      toDate: "2026-10-31",
    });

    await render(<TransactionMonthList {...props} kind="upcoming" />);
    const upcoming = mockQuery.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(upcoming.fromDate).toBeUndefined();
    expect(upcoming.toDate).toBeUndefined();
    expect(upcoming.statuses).toEqual(["upcoming"]);

    await render(<TransactionMonthList {...props} allMonths />);
    expect(
      (mockQuery.mock.calls.at(-1)?.[0] as Record<string, unknown>).fromDate,
    ).toBeUndefined();
  });

  it("says nothing about a month when Upcoming is empty", async () => {
    mockRows = [];
    await render(<TransactionMonthList {...props} kind="upcoming" />);
    expect(screen.getByText("Try another search or filter.")).toBeTruthy();
    expect(screen.queryByText(/Nothing in/)).toBeNull();
  });

  it("puts the year on a day that is not in the current year, and only on that day", async () => {
    const thisYear = new Date().getFullYear();
    mockRows = [tx("now", `${thisYear}-01-15`), tx("old", "2019-03-05")];
    await render(<TransactionMonthList {...props} />);
    const headers = screen
      .getAllByText(/Jan 15|Mar 5/)
      .map((node) => String(node.props.children));
    expect(headers).toHaveLength(2);
    const old = headers.find((text) => text.includes("Mar 5"));
    const current = headers.find((text) => text.includes("Jan 15"));
    expect(old).toContain("2019");
    expect(current).not.toContain(String(thisYear));
  });
});
