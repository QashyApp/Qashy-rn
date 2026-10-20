import {
  WIDGET_KINDS,
  buildKindPayload,
  isWidgetKind,
  knownPlacedWidgets,
  widgetKind,
} from "@/features/widgets/kinds";
import {
  DEFAULT_APPEARANCE,
  defaultWidgetConfig,
  normalizeWidgetConfig,
} from "@/features/widgets/settings";

describe("widget kind registry", () => {
  it("lists the kinds the native side registers", () => {
    expect([...WIDGET_KINDS].sort()).toEqual(["summary", "transactions"]);
  });

  it("recognises only registered kinds", () => {
    expect(isWidgetKind("summary")).toBe(true);
    expect(isWidgetKind("transactions")).toBe(true);
    expect(isWidgetKind("budget")).toBe(false);
    expect(isWidgetKind("toString")).toBe(false);
    expect(isWidgetKind(undefined)).toBe(false);
  });

  it("keeps placed widgets of known kinds and drops the rest", () => {
    expect(
      knownPlacedWidgets([
        { id: 1, kind: "summary" },
        { id: 2, kind: "budget" },
        { id: 3, kind: "transactions" },
      ]),
    ).toEqual([
      { id: 1, kind: "summary" },
      { id: 3, kind: "transactions" },
    ]);
  });

  it.each(WIDGET_KINDS)(
    "%s: its default config is what its own normalizer keeps",
    (kind) => {
      const config = defaultWidgetConfig(kind);
      expect(config).toEqual({
        kind,
        ...DEFAULT_APPEARANCE,
        ...widgetKind(kind).defaults,
      });
      expect(normalizeWidgetConfig(config)).toEqual(config);
      expect(normalizeWidgetConfig({ kind })).toEqual(config);
    },
  );

  it.each(WIDGET_KINDS)("%s: builds a payload keyed by its kind", (kind) => {
    const payload = buildKindPayload(
      defaultWidgetConfig(kind),
      {
        placed: [],
        settings: { hideAmounts: false, widgets: {} },
        source: {
          accounts: [],
          categories: [],
          queryTransactions: () => [],
          getDashboard: () => ({
            incomeMinor: 0,
            expenseMinor: 0,
            netWorthMinor: 0,
          }),
          getNetWorthSeries: () => ({ baseCurrency: "USD", points: [] }),
        },
        palettes: () => {
          throw new Error("not needed");
        },
        t: (message) => message,
        locale: "en",
        today: "2026-07-15",
        now: new Date("2026-07-15T10:00:00.000Z"),
      },
      false,
    );
    expect(Object.keys(payload)).toEqual([kind]);
  });
});
