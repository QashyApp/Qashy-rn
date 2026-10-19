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
    expect(defaultWidgetConfig("transactions")).toEqual({
      kind: "transactions",
      theme: "qashy",
      mode: "system",
      background: "surface",
      customColor: null,
      opacity: 100,
      frosted: false,
      accountId: null,
    });
    expect(defaultWidgetConfig("summary")).toEqual({
      kind: "summary",
      ...DEFAULT_APPEARANCE,
      graphMonths: 12,
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
      kind: "transactions",
      theme: "neon",
      mode: "dark",
      background: "gradient",
      customColor: "red",
      opacity: 140,
      frosted: "yes",
      accountId: 12,
    });
    expect(config).toEqual({
      ...defaultWidgetConfig("transactions"),
      mode: "dark",
    });
  });

  it("validates opacity as an integer from 0 to 100", () => {
    const opacity = (value: unknown) =>
      normalizeWidgetConfig({ kind: "summary", opacity: value })?.opacity;
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
      normalizeWidgetConfig({ kind: "summary", customColor: value })
        ?.customColor;
    expect(color("#a1b2c3")).toBe("#A1B2C3");
    expect(color("#abc")).toBeNull();
    expect(color("#a1b2c3ff")).toBeNull();
    expect(color("a1b2c3")).toBeNull();
    expect(color(null)).toBeNull();
  });

  it("validates graphMonths and accountId", () => {
    const summary = (graphMonths: unknown) =>
      normalizeWidgetConfig({ kind: "summary", graphMonths });
    expect(summary(3)).toMatchObject({ graphMonths: 3 });
    expect(summary(6)).toMatchObject({ graphMonths: 6 });
    expect(summary(24)).toMatchObject({ graphMonths: 12 });
    expect(summary("6")).toMatchObject({ graphMonths: 12 });
    expect(
      normalizeWidgetConfig({ kind: "transactions", accountId: "abc" }),
    ).toMatchObject({ accountId: "abc" });
    expect(
      normalizeWidgetConfig({ kind: "transactions", accountId: "" }),
    ).toMatchObject({ accountId: null });
  });

  it("drops configs with an unknown kind or a non-numeric id", () => {
    const settings = normalizeWidgetSettings({
      hideAmounts: true,
      widgets: {
        "12": { kind: "summary" },
        "13": { kind: "clock" },
        "14": "nope",
        abc: { kind: "summary" },
        "-5": { kind: "summary" },
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
        { kind: "summary" },
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
          ...defaultWidgetConfig("transactions"),
          accountId: "acc",
          opacity: 40,
          frosted: true,
          background: "custom" as const,
          customColor: "#112233",
        },
        "8": { ...defaultWidgetConfig("summary"), graphMonths: 3 as const },
      },
    };
    expect(parseWidgetSettings(serializeWidgetSettings(settings))).toEqual(
      settings,
    );
  });

  it("falls back to the default config when none, or one of another kind, is stored", () => {
    const settings = normalizeWidgetSettings({
      widgets: { "1": { kind: "summary", graphMonths: 3 } },
    });
    expect(configFor(settings, 1, "summary")).toMatchObject({ graphMonths: 3 });
    expect(configFor(settings, 1, "transactions")).toEqual(
      defaultWidgetConfig("transactions"),
    );
    expect(configFor(settings, 2, "summary")).toEqual(
      defaultWidgetConfig("summary"),
    );
  });
});
