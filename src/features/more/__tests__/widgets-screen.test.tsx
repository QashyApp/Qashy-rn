import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { WidgetsScreen } from "@/features/more/widgets-screen";
import {
  defaultWidgetConfig,
  type WidgetSettings,
} from "@/features/widgets/settings";

let mockAvailable = true;
let mockPlaced: { id: number; kind: "quickAdd" | "budget" }[] = [];
let mockParams: { widgetId?: string } = {};
let mockSettings: WidgetSettings = { hideAmounts: false, widgets: {} };
let mockReadGate: Promise<void> | null = null;
const mockListeners = new Set<() => void>();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock("../../../../modules/qashy-widgets", () => ({
  isAvailable: () => mockAvailable,
  getPlacedWidgets: async () => mockPlaced,
}));
jest.mock("@/data/widget-settings-store", () => ({
  readWidgetSettings: async () => {
    if (mockReadGate) await mockReadGate;
    return mockSettings;
  },
  subscribeWidgetSettings: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
  updateWidgetSettings: async (
    update: (current: WidgetSettings) => WidgetSettings | null,
  ) => {
    const next = update(mockSettings);
    if (next) mockSettings = next;
    return mockSettings;
  },
}));
jest.mock("@/features/more/widget-transparency-slider", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    WidgetTransparencySlider: ({ value }: { value: number }) => (
      <Text>{`slider ${value}`}</Text>
    ),
  };
});
jest.mock("@/providers/finance-provider", () => ({
  useFinanceState: () => ({
    budgets: [
      { id: "b1", name: "Groceries", archived: false },
      { id: "b2", name: "Old plan", archived: true },
      { id: "b3", name: "Gone", archived: false, deletedAt: "2026-01-01" },
    ],
  }),
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

const settle = () => act(async () => undefined);

describe("WidgetsScreen", () => {
  beforeEach(() => {
    mockAvailable = true;
    mockPlaced = [];
    mockParams = {};
    mockSettings = { hideAmounts: false, widgets: {} };
    mockReadGate = null;
    mockListeners.clear();
  });

  it("explains that widgets are an Android feature when the module is missing", async () => {
    mockAvailable = false;
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Widgets are an Android feature")).toBeTruthy();
    expect(screen.queryByText("Hide amounts")).toBeNull();
  });

  it("shows how to add a widget when none is placed", async () => {
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("No widgets yet")).toBeTruthy();
    expect(screen.getByText("Hide amounts")).toBeTruthy();
  });

  it("numbers several widgets of one kind and edits one without touching the others", async () => {
    mockPlaced = [
      { id: 12, kind: "quickAdd" },
      { id: 7, kind: "budget" },
      { id: 9, kind: "budget" },
    ];
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Budget widget 1")).toBeTruthy();
    expect(screen.getByText("Budget widget 2")).toBeTruthy();
    expect(screen.getByText("Quick add widget")).toBeTruthy();
    // Archived budgets are not offered.
    expect(screen.queryByText("Old plan")).toBeNull();

    // The switch comes first; "Spent" is also an option of the small-widget choice below it.
    await fireEvent(screen.getAllByLabelText("Spent")[0], "valueChange", false);
    await settle();
    expect(mockSettings.widgets["12"]).toMatchObject({
      kind: "quickAdd",
      showNetWorth: true,
      showSpent: false,
      showEarned: true,
    });
    // Turning a metric off leaves two to choose between for the small widget: pick Income.
    await fireEvent.press(screen.getByRole("radio", { name: "Income" }));
    await settle();
    expect(mockSettings.widgets["12"]).toMatchObject({
      primaryMetric: "earned",
    });
    expect(mockSettings.widgets["7"]).toBeUndefined();

    await fireEvent.press(
      screen.getAllByRole("radio", { name: "Groceries" })[1],
    );
    await settle();
    expect(mockSettings.widgets["9"]).toMatchObject({
      kind: "budget",
      budgetId: "b1",
    });
    expect(mockSettings.widgets["7"]).toBeUndefined();
  });

  it("toggles hide amounts through the atomic update", async () => {
    await render(<WidgetsScreen />);
    await settle();
    await fireEvent(screen.getByLabelText("Hide amounts"), "valueChange", true);
    await settle();
    expect(mockSettings.hideAmounts).toBe(true);
  });

  it("shows the transparency as the inverse of the stored opacity", async () => {
    mockPlaced = [{ id: 3, kind: "quickAdd" }];
    mockSettings = {
      hideAmounts: false,
      widgets: { "3": { ...defaultWidgetConfig("quickAdd"), opacity: 80 } },
    };
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("slider 20")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
  });

  it("opens on the widget named by widgetId, with a way to see them all", async () => {
    mockPlaced = [
      { id: 7, kind: "budget" },
      { id: 12, kind: "quickAdd" },
    ];
    mockParams = { widgetId: "12" };
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Quick add widget")).toBeTruthy();
    expect(screen.queryByText("Budget widget")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show all widgets" }),
    );
    await settle();
    expect(screen.getByText("Budget widget")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Show all widgets" }),
    ).toBeNull();
  });

  it("falls back to every widget when widgetId names one that is not placed", async () => {
    mockPlaced = [
      { id: 7, kind: "budget" },
      { id: 12, kind: "quickAdd" },
    ];
    mockParams = { widgetId: "99" };
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Budget widget")).toBeTruthy();
    expect(screen.getByText("Quick add widget")).toBeTruthy();
  });

  it("focuses the widget of a new deep link even after Show all was pressed", async () => {
    mockPlaced = [
      { id: 7, kind: "budget" },
      { id: 12, kind: "quickAdd" },
    ];
    mockParams = { widgetId: "12" };
    const view = await render(<WidgetsScreen />);
    await settle();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show all widgets" }),
    );
    await settle();
    expect(screen.getByText("Budget widget")).toBeTruthy();
    mockParams = { widgetId: "7" };
    await view.rerender(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Budget widget")).toBeTruthy();
    expect(screen.queryByText("Quick add widget")).toBeNull();
  });

  it("does not draw the Hide amounts switch until the stored value is read", async () => {
    let open!: () => void;
    mockReadGate = new Promise<void>((resolve) => (open = resolve));
    mockSettings = { hideAmounts: true, widgets: {} };
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.queryByText("Hide amounts")).toBeNull();
    open();
    await settle();
    expect(screen.getByText("Hide amounts")).toBeTruthy();
    expect(screen.getByLabelText("Hide amounts")).toBeTruthy();
  });
});
