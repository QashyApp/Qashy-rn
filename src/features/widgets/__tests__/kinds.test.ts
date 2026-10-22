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
    expect([...WIDGET_KINDS].sort()).toEqual(["budget", "quickAdd"]);
  });

  it("recognises only registered kinds", () => {
    expect(isWidgetKind("quickAdd")).toBe(true);
    expect(isWidgetKind("budget")).toBe(true);
    // The removed kinds are no longer registered.
    expect(isWidgetKind("summary")).toBe(false);
    expect(isWidgetKind("transactions")).toBe(false);
    expect(isWidgetKind("toString")).toBe(false);
    expect(isWidgetKind(undefined)).toBe(false);
  });

  it("keeps placed widgets of known kinds and drops the rest", () => {
    expect(
      knownPlacedWidgets([
        { id: 1, kind: "quickAdd" },
        { id: 2, kind: "summary" },
        { id: 3, kind: "budget" },
        { id: 4, kind: "transactions" },
      ]),
    ).toEqual([
      { id: 1, kind: "quickAdd" },
      { id: 3, kind: "budget" },
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
          baseCurrency: "USD",
          getDashboard: () => ({
            incomeMinor: 0,
            expenseMinor: 0,
            netWorthMinor: 0,
          }),
          getBudgetStatuses: () => [],
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
