import {
  DEFAULT_APPEARANCE,
  MAX_WIDGET_CONFIGS,
  configFor,
  defaultWidgetConfig,
  normalizeWidgetConfig,
  normalizeWidgetSettings,
  parseWidgetSettings,
  serializeWidgetSettings,
} from "@/features/widgets/settings";

describe("widget settings", () => {
  it("has the documented defaults", () => {
    expect(defaultWidgetConfig("budget")).toEqual({
      kind: "budget",
      theme: "qashy",
      mode: "system",
      background: "surface",
      customColor: null,
      opacity: 100,
      frosted: false,
      budgetId: null,
    });
    expect(defaultWidgetConfig("quickAdd")).toEqual({
      kind: "quickAdd",
      ...DEFAULT_APPEARANCE,
      showNetWorth: true,
      showSpent: true,
      showEarned: true,
      primaryMetric: "netWorth",
    });
    expect(parseWidgetSettings(undefined)).toEqual({
      hideAmounts: false,
      widgets: {},
    });
  });

  it("never throws on bad stored JSON", () => {
    for (const raw of ["", "{", "null", "[]", "42", '"x"', '{"widgets":7}']) {
      expect(parseWidgetSettings(raw)).toEqual({
        hideAmounts: false,
        widgets: {},
      });
    }
  });

  it("replaces each invalid field with its own default and keeps the valid ones", () => {
    const config = normalizeWidgetConfig({
      kind: "budget",
      theme: "neon",
      mode: "dark",
      background: "gradient",
      customColor: "red",
      opacity: 140,
      frosted: "yes",
      budgetId: 12,
    });
    expect(config).toEqual({
      ...defaultWidgetConfig("budget"),
      mode: "dark",
    });
  });

  it("validates opacity as an integer from 0 to 100", () => {
    const opacity = (value: unknown) =>
      normalizeWidgetConfig({ kind: "quickAdd", opacity: value })?.opacity;
    expect(opacity(0)).toBe(0);
    expect(opacity(100)).toBe(100);
    expect(opacity(55)).toBe(55);
    expect(opacity(55.5)).toBe(100);
    expect(opacity(-1)).toBe(100);
    expect(opacity(101)).toBe(100);
    expect(opacity(Number.NaN)).toBe(100);
    expect(opacity("50")).toBe(100);
  });

  it("accepts only #RRGGBB custom colors, normalized to upper case", () => {
    const color = (value: unknown) =>
      normalizeWidgetConfig({ kind: "quickAdd", customColor: value })
        ?.customColor;
    expect(color("#a1b2c3")).toBe("#A1B2C3");
    expect(color("#abc")).toBeNull();
    expect(color("#a1b2c3ff")).toBeNull();
    expect(color("a1b2c3")).toBeNull();
    expect(color(null)).toBeNull();
  });

  it("validates the metric toggles and the budget id", () => {
    const quickAdd = (raw: Record<string, unknown>) =>
      normalizeWidgetConfig({ kind: "quickAdd", ...raw });
    expect(quickAdd({ showSpent: false })).toMatchObject({
      showNetWorth: true,
      showSpent: false,
      showEarned: true,
    });
    expect(
      quickAdd({ showNetWorth: false, showSpent: false, showEarned: false }),
    ).toMatchObject({
      showNetWorth: false,
      showSpent: false,
      showEarned: false,
    });
    // Only a real boolean counts; anything else is the default (shown).
    expect(quickAdd({ showSpent: "no", showEarned: 0 })).toMatchObject({
      showSpent: true,
      showEarned: true,
    });
    // The metric for a small widget: one of the three, else net worth.
    expect(quickAdd({ primaryMetric: "spent" })).toMatchObject({
      primaryMetric: "spent",
    });
    for (const bad of ["income", "", 3, null, undefined])
      expect(quickAdd({ primaryMetric: bad })).toMatchObject({
        primaryMetric: "netWorth",
      });
    expect(
      normalizeWidgetConfig({ kind: "budget", budgetId: "abc" }),
    ).toMatchObject({ budgetId: "abc" });
    expect(
      normalizeWidgetConfig({ kind: "budget", budgetId: "" }),
    ).toMatchObject({ budgetId: null });
  });

  it("drops the configs of the removed kinds", () => {
    const settings = normalizeWidgetSettings({
      widgets: {
        "1": { kind: "summary", graphMonths: 3 },
        "2": { kind: "transactions", accountId: "a" },
        "3": { kind: "quickAdd" },
      },
    });
    expect(Object.keys(settings.widgets)).toEqual(["3"]);
  });

  it("drops configs with an unknown kind or a non-numeric id", () => {
    const settings = normalizeWidgetSettings({
      hideAmounts: true,
      widgets: {
        "12": { kind: "quickAdd" },
        "13": { kind: "clock" },
        "14": "nope",
        abc: { kind: "quickAdd" },
        "-5": { kind: "quickAdd" },
      },
    });
    expect(Object.keys(settings.widgets)).toEqual(["12"]);
    expect(settings.hideAmounts).toBe(true);
  });

  it("treats hideAmounts as on only for a literal true", () => {
    expect(normalizeWidgetSettings({ hideAmounts: "true" }).hideAmounts).toBe(
      false,
    );
    expect(normalizeWidgetSettings({ hideAmounts: 1 }).hideAmounts).toBe(false);
  });

  it("caps how many configs a document can hold", () => {
    const widgets = Object.fromEntries(
      Array.from({ length: MAX_WIDGET_CONFIGS + 20 }, (_, i) => [
        String(i + 1),
        { kind: "quickAdd" },
      ]),
    );
    expect(
      Object.keys(normalizeWidgetSettings({ widgets }).widgets),
    ).toHaveLength(MAX_WIDGET_CONFIGS);
  });

  it("round-trips through serialize and parse", () => {
    const settings = {
      hideAmounts: true,
      widgets: {
        "7": {
          ...defaultWidgetConfig("budget"),
          budgetId: "bud",
          opacity: 40,
          frosted: true,
          background: "custom" as const,
          customColor: "#112233",
        },
        "8": { ...defaultWidgetConfig("quickAdd"), showSpent: false },
      },
    };
    expect(parseWidgetSettings(serializeWidgetSettings(settings))).toEqual(
      settings,
    );
  });

  it("falls back to the default config when none, or one of another kind, is stored", () => {
    const settings = normalizeWidgetSettings({
      widgets: { "1": { kind: "quickAdd", showSpent: false } },
    });
    expect(configFor(settings, 1, "quickAdd")).toMatchObject({
      showSpent: false,
    });
    expect(configFor(settings, 1, "budget")).toEqual(
      defaultWidgetConfig("budget"),
    );
    expect(configFor(settings, 2, "quickAdd")).toEqual(
      defaultWidgetConfig("quickAdd"),
    );
  });
});
