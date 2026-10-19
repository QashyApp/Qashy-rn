import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { WidgetsScreen } from "@/features/more/widgets-screen";
import {
  defaultWidgetConfig,
  type WidgetSettings,
} from "@/features/widgets/settings";

let mockAvailable = true;
let mockPlaced: { id: number; kind: "transactions" | "summary" }[] = [];
let mockParams: { widgetId?: string } = {};
let mockSettings: WidgetSettings = { hideAmounts: false, widgets: {} };
const mockListeners = new Set<() => void>();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock("../../../../modules/qashy-widgets", () => ({
  isAvailable: () => mockAvailable,
  getPlacedWidgets: async () => mockPlaced,
}));
jest.mock("@/data/widget-settings-store", () => ({
  readWidgetSettings: async () => mockSettings,
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
    accounts: [
      { id: "a1", name: "Cash", currency: "USD", archived: false },
      { id: "a2", name: "Old", currency: "EUR", archived: true },
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
      { id: 12, kind: "summary" },
      { id: 7, kind: "transactions" },
      { id: 9, kind: "transactions" },
    ];
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Transactions widget 1")).toBeTruthy();
    expect(screen.getByText("Transactions widget 2")).toBeTruthy();
    expect(screen.getByText("Summary widget")).toBeTruthy();
    // Archived accounts are not offered.
    expect(screen.queryByText("Old")).toBeNull();

    await fireEvent.press(screen.getByRole("radio", { name: "6 months" }));
    await settle();
    expect(mockSettings.widgets["12"]).toMatchObject({
      kind: "summary",
      graphMonths: 6,
    });
    expect(mockSettings.widgets["7"]).toBeUndefined();

    await fireEvent.press(
      screen.getAllByRole("radio", { name: "Cash, USD" })[1],
    );
    await settle();
    expect(mockSettings.widgets["9"]).toMatchObject({
      kind: "transactions",
      accountId: "a1",
    });
  });

  it("toggles hide amounts through the atomic update", async () => {
    await render(<WidgetsScreen />);
    await settle();
    await fireEvent(screen.getByLabelText("Hide amounts"), "valueChange", true);
    await settle();
    expect(mockSettings.hideAmounts).toBe(true);
  });

  it("shows the transparency as the inverse of the stored opacity", async () => {
    mockPlaced = [{ id: 3, kind: "summary" }];
    mockSettings = {
      hideAmounts: false,
      widgets: { "3": { ...defaultWidgetConfig("summary"), opacity: 80 } },
    };
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("slider 20")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
  });

  it("opens on the widget named by widgetId, with a way to see them all", async () => {
    mockPlaced = [
      { id: 7, kind: "transactions" },
      { id: 12, kind: "summary" },
    ];
    mockParams = { widgetId: "12" };
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Summary widget")).toBeTruthy();
    expect(screen.queryByText("Transactions widget")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show all widgets" }),
    );
    await settle();
    expect(screen.getByText("Transactions widget")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Show all widgets" }),
    ).toBeNull();
  });

  it("falls back to every widget when widgetId names one that is not placed", async () => {
    mockPlaced = [
      { id: 7, kind: "transactions" },
      { id: 12, kind: "summary" },
    ];
    mockParams = { widgetId: "99" };
    await render(<WidgetsScreen />);
    await settle();
    expect(screen.getByText("Transactions widget")).toBeTruthy();
    expect(screen.getByText("Summary widget")).toBeTruthy();
  });
});
