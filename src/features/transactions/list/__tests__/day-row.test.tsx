import { render, screen } from "@testing-library/react-native";
import type { ReactTestRendererJSON } from "react-test-renderer";

import type { TransactionRecord } from "@/domain/models";
import { DayRow } from "@/features/transactions/list/transaction-month-list";

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

// The row's own content needs the finance snapshot; here it only has to be there.
jest.mock("@/components/finance/transaction-row", () => {
  const { View: Host } = jest.requireActual("react-native");
  return { TransactionRow: () => <Host testID="row-content" /> };
});

// The flash is hidden from assistive technology, which is also what the default queries skip.
const HIDDEN = { includeHiddenElements: true };

const item = {
  id: "t1",
  kind: "expense",
  status: "posted",
} as unknown as TransactionRecord;

function renderRow(flashes: number) {
  return render(
    <DayRow
      item={item}
      order={0}
      first
      last
      selected={false}
      paying={false}
      selectionMode={false}
      flashes={flashes}
      flashToken={1}
      onFlashDone={jest.fn()}
      onToggleItem={jest.fn()}
      onLongPressItem={jest.fn()}
      registerRow={jest.fn()}
      onArmDrag={jest.fn()}
      onRowAction={jest.fn()}
    />,
  );
}

type Json = ReactTestRendererJSON;

function contains(node: Json | string, testID: string): boolean {
  if (typeof node === "string") return false;
  if (node.props.testID === testID) return true;
  return (node.children ?? []).some((child) => contains(child, testID));
}

/** The children of the first view where the two test ids sit in different children. */
function whereTheyPart(node: Json, a: string, b: string): (Json | string)[] {
  const children = node.children ?? [];
  const next = children.find(
    (child): child is Json =>
      typeof child !== "string" && contains(child, a) && contains(child, b),
  );
  return next ? whereTheyPart(next, a, b) : children;
}

describe("DayRow", () => {
  it("paints the saved-row flash above the row's content, not under its opaque fill", async () => {
    await renderRow(2);
    // Later siblings paint on top of earlier ones.
    const tree = screen.toJSON() as Json;
    const siblings = whereTheyPart(tree, "row-flash", "row-content");
    const flashAt = siblings.findIndex((child) => contains(child, "row-flash"));
    const contentAt = siblings.findIndex((child) =>
      contains(child, "row-content"),
    );
    expect(contentAt).toBeGreaterThanOrEqual(0);
    expect(flashAt).toBeGreaterThan(contentAt);
    expect(siblings[flashAt]).toMatchObject({
      props: { testID: "row-flash", pointerEvents: "none" },
    });
  });

  it("draws no flash for a row that was not just saved", async () => {
    await renderRow(0);
    expect(screen.queryByTestId("row-flash", HIDDEN)).toBeNull();
    expect(screen.getByTestId("row-content")).toBeTruthy();
  });
});
