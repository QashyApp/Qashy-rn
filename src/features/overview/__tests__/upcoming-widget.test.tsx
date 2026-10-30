import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  UpcomingActionsContext,
  type UpcomingActions,
} from "@/features/overview/widgets/upcoming-actions";
import { UpcomingWidget } from "@/features/overview/widgets/upcoming-widget";
import type { WidgetProps } from "@/features/overview/widgets/types";

jest.mock("react-native-reanimated", () =>
  jest.requireActual("react-native-reanimated/mock"),
);

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

// The row is a heavy, separately tested view; here it only has to show which payment it is.
jest.mock("@/components/finance/transaction-row", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    TransactionRow: ({ transaction }: { transaction: { title: string } }) => (
      <Text>{transaction.title}</Text>
    ),
  };
});

jest.mock("@/components/ui/motion", () => {
  const { View } = jest.requireActual("react-native");
  return { ...jest.requireActual("@/components/ui/motion"), MotionView: View };
});

function summaryWith(titles: string[]) {
  return {
    upcomingTransactions: titles.map((title) => ({ id: title, title })),
  } as unknown as WidgetProps["summary"];
}

async function renderWidget(
  titles: string[],
  actions: Partial<UpcomingActions> = {},
  editing = false,
) {
  const value: UpcomingActions = {
    hiddenIds: new Set(),
    paidIds: new Set(),
    resolve: jest.fn(),
    ...actions,
  };
  const wrap = (node: ReactNode) => (
    <UpcomingActionsContext value={value}>{node}</UpcomingActionsContext>
  );
  return {
    value,
    ...(await render(
      wrap(
        <UpcomingWidget
          card={
            { id: "c", type: "upcoming", size: "medium", config: {} } as never
          }
          month="2026-10-01"
          size={"medium" as never}
          editing={editing}
          summary={summaryWith(titles)}
        />,
      ),
    )),
  };
}

describe("UpcomingWidget", () => {
  it("defers Skip and Mark paid to the shared undoable queue", async () => {
    const { value } = await renderWidget(["Rent"]);
    await fireEvent.press(screen.getByLabelText("Skip: Rent"));
    expect(value.resolve).toHaveBeenCalledWith("Rent", "skip");
    await fireEvent.press(screen.getByLabelText("Mark paid: Rent"));
    expect(value.resolve).toHaveBeenCalledWith("Rent", "markPaid");
  });

  it("hides a row while its skip or payment waits on Undo", async () => {
    await renderWidget(["Rent", "Gym", "Phone"], {
      hiddenIds: new Set(["Rent"]),
      paidIds: new Set(["Gym"]),
    });
    expect(screen.queryByText("Rent")).toBeNull();
    expect(screen.queryByText("Gym")).toBeNull();
    expect(screen.getByText("Phone")).toBeTruthy();
  });

  it("shows the empty state once every row is waiting", async () => {
    await renderWidget(["Rent"], { hiddenIds: new Set(["Rent"]) });
    expect(screen.getByText("Nothing due yet")).toBeTruthy();
  });

  it("leaves the buttons inert while the cards are being edited", async () => {
    const { value } = await renderWidget(["Rent"], {}, true);
    await fireEvent.press(screen.getByLabelText("Skip: Rent"));
    expect(value.resolve).not.toHaveBeenCalled();
  });
});
