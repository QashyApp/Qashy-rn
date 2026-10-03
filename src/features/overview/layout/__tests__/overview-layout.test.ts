import {
  availableToAdd,
  DEFAULT_OVERVIEW_LAYOUT,
  normalizeOverviewLayout,
  overviewLayoutReducer,
  serializeOverviewLayout,
  WIDGET_RULES,
  type OverviewLayout,
} from "@/features/overview/layout/overview-layout";

const layoutWith = (cards: OverviewLayout["cards"]): OverviewLayout => ({
  version: 1,
  cards,
});

describe("overviewLayoutReducer: add", () => {
  it("appends a card at the end by default, with the type default size", () => {
    const layout = layoutWith([]);
    const next = overviewLayoutReducer(layout, {
      type: "add",
      card: { id: "a", type: "accounts" },
    });
    expect(next.cards).toEqual([
      { id: "a", type: "accounts", size: "regular", config: {} },
    ]);
  });

  it("inserts at a given index", () => {
    const layout = layoutWith([
      { id: "a", type: "accounts", size: "regular", config: {} },
      { id: "b", type: "top-categories", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "add",
      card: { id: "c", type: "goals" },
      index: 1,
    });
    expect(next.cards.map((c) => c.id)).toEqual(["a", "c", "b"]);
  });

  it("falls back to the default size when an invalid size is given", () => {
    const next = overviewLayoutReducer(layoutWith([]), {
      type: "add",
      card: { id: "a", type: "insight", size: "compact" as never },
    });
    expect(next.cards[0].size).toBe(WIDGET_RULES.insight.defaultSize);
  });

  it("uses a valid explicit size when given", () => {
    const next = overviewLayoutReducer(layoutWith([]), {
      type: "add",
      card: { id: "a", type: "goals", size: "compact" },
    });
    expect(next.cards[0].size).toBe("compact");
  });

  it("is a no-op when the id already exists (same reference returned)", () => {
    const layout = layoutWith([
      { id: "a", type: "accounts", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "add",
      card: { id: "a", type: "goals" },
    });
    expect(next).toBe(layout);
  });

  it("is a no-op when the type is single-instance and already present", () => {
    const layout = layoutWith([
      { id: "a", type: "accounts", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "add",
      card: { id: "b", type: "accounts" },
    });
    expect(next).toBe(layout);
  });

  it("allows multiple cards for a `multiple: true` type", () => {
    const layout = layoutWith([
      { id: "a", type: "goals", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "add",
      card: { id: "b", type: "goals" },
    });
    expect(next.cards).toHaveLength(2);
  });

  it("copies the given config rather than aliasing it", () => {
    const config = { pinnedBudgetId: "x" };
    const next = overviewLayoutReducer(layoutWith([]), {
      type: "add",
      card: { id: "a", type: "budget-pulse", config },
    });
    config.pinnedBudgetId = "y";
    expect(next.cards[0].config).toEqual({ pinnedBudgetId: "x" });
  });
});

describe("overviewLayoutReducer: remove", () => {
  it("removes the card with the given id", () => {
    const layout = layoutWith([
      { id: "a", type: "accounts", size: "regular", config: {} },
      { id: "b", type: "goals", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, { type: "remove", id: "a" });
    expect(next.cards.map((c) => c.id)).toEqual(["b"]);
  });

  it("is a no-op for an unknown id (same reference)", () => {
    const layout = layoutWith([
      { id: "a", type: "accounts", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, { type: "remove", id: "zzz" });
    expect(next).toBe(layout);
  });
});

describe("overviewLayoutReducer: move / moveBy", () => {
  const layout = layoutWith([
    { id: "a", type: "accounts", size: "regular", config: {} },
    { id: "b", type: "goals", size: "regular", config: {} },
    { id: "c", type: "upcoming", size: "wide", config: {} },
  ]);

  it("moves a card to a given index", () => {
    const next = overviewLayoutReducer(layout, {
      type: "move",
      id: "c",
      toIndex: 0,
    });
    expect(next.cards.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("clamps an out-of-range toIndex", () => {
    const next = overviewLayoutReducer(layout, {
      type: "move",
      id: "a",
      toIndex: 999,
    });
    expect(next.cards.map((c) => c.id)).toEqual(["b", "c", "a"]);

    const next2 = overviewLayoutReducer(layout, {
      type: "move",
      id: "a",
      toIndex: -10,
    });
    expect(next2.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op (same reference) when moving to its own index", () => {
    const next = overviewLayoutReducer(layout, {
      type: "move",
      id: "b",
      toIndex: 1,
    });
    expect(next).toBe(layout);
  });

  it("is a no-op for an unknown id", () => {
    const next = overviewLayoutReducer(layout, {
      type: "move",
      id: "zzz",
      toIndex: 0,
    });
    expect(next).toBe(layout);
  });

  it("moveBy shifts by a delta and clamps at the edges", () => {
    const up = overviewLayoutReducer(layout, {
      type: "moveBy",
      id: "b",
      delta: -1,
    });
    expect(up.cards.map((c) => c.id)).toEqual(["b", "a", "c"]);

    const clampedDown = overviewLayoutReducer(layout, {
      type: "moveBy",
      id: "c",
      delta: 5,
    });
    expect(clampedDown.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(clampedDown).toBe(layout);
  });

  it("moveBy is a no-op for an unknown id", () => {
    const next = overviewLayoutReducer(layout, {
      type: "moveBy",
      id: "zzz",
      delta: 1,
    });
    expect(next).toBe(layout);
  });
});

describe("overviewLayoutReducer: resize", () => {
  it("changes the size when allowed", () => {
    const layout = layoutWith([
      { id: "a", type: "goals", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "resize",
      id: "a",
      size: "compact",
    });
    expect(next.cards[0].size).toBe("compact");
  });

  it("is a no-op when the size is not allowed for that type", () => {
    const layout = layoutWith([
      { id: "a", type: "accounts", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "resize",
      id: "a",
      size: "compact",
    });
    expect(next).toBe(layout);
  });

  it("is a no-op when resizing to the current size", () => {
    const layout = layoutWith([
      { id: "a", type: "goals", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "resize",
      id: "a",
      size: "regular",
    });
    expect(next).toBe(layout);
  });

  it("is a no-op for an unknown id", () => {
    const layout = layoutWith([
      { id: "a", type: "goals", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "resize",
      id: "zzz",
      size: "compact",
    });
    expect(next).toBe(layout);
  });
});

describe("overviewLayoutReducer: configure", () => {
  it("shallow-merges the given config into the card", () => {
    const layout = layoutWith([
      {
        id: "a",
        type: "budget-pulse",
        size: "regular",
        config: { pinnedBudgetId: "x", foo: 1 },
      },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "configure",
      id: "a",
      config: { pinnedBudgetId: "y" },
    });
    expect(next.cards[0].config).toEqual({ pinnedBudgetId: "y", foo: 1 });
  });

  it("is a no-op for an unknown id", () => {
    const layout = layoutWith([
      { id: "a", type: "budget-pulse", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, {
      type: "configure",
      id: "zzz",
      config: {},
    });
    expect(next).toBe(layout);
  });
});

describe("overviewLayoutReducer: reset", () => {
  it("returns the default layout", () => {
    const layout = layoutWith([
      { id: "a", type: "goals", size: "regular", config: {} },
    ]);
    const next = overviewLayoutReducer(layout, { type: "reset" });
    expect(next).toBe(DEFAULT_OVERVIEW_LAYOUT);
  });

  it("is a no-op (same reference) when already at the default", () => {
    const next = overviewLayoutReducer(DEFAULT_OVERVIEW_LAYOUT, {
      type: "reset",
    });
    expect(next).toBe(DEFAULT_OVERVIEW_LAYOUT);
  });
});

describe("normalizeOverviewLayout", () => {
  it("defaults on null, undefined, and non-object input", () => {
    expect(normalizeOverviewLayout(null)).toBe(DEFAULT_OVERVIEW_LAYOUT);
    expect(normalizeOverviewLayout(undefined)).toBe(DEFAULT_OVERVIEW_LAYOUT);
    expect(normalizeOverviewLayout("not json")).toBe(DEFAULT_OVERVIEW_LAYOUT);
    expect(normalizeOverviewLayout(42)).toBe(DEFAULT_OVERVIEW_LAYOUT);
  });

  it("defaults on a wrong version", () => {
    expect(normalizeOverviewLayout({ version: 2, cards: [] })).toBe(
      DEFAULT_OVERVIEW_LAYOUT,
    );
  });

  it("drops cards with unknown types", () => {
    const result = normalizeOverviewLayout({
      version: 1,
      cards: [
        { id: "a", type: "accounts" },
        { id: "b", type: "not-a-real-widget" },
      ],
    });
    expect(result.cards.map((c) => c.id)).toEqual(["a"]);
  });

  it("drops cards with a duplicate id, keeping the first", () => {
    const result = normalizeOverviewLayout({
      version: 1,
      cards: [
        { id: "a", type: "accounts" },
        { id: "a", type: "goals" },
      ],
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].type).toBe("accounts");
  });

  it("drops duplicate single-instance types, keeping the first", () => {
    const result = normalizeOverviewLayout({
      version: 1,
      cards: [
        { id: "a", type: "accounts" },
        { id: "b", type: "accounts" },
      ],
    });
    expect(result.cards.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps duplicate types when `multiple` is true", () => {
    const result = normalizeOverviewLayout({
      version: 1,
      cards: [
        { id: "a", type: "goals" },
        { id: "b", type: "goals" },
      ],
    });
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("replaces an invalid size with the type default", () => {
    const result = normalizeOverviewLayout({
      version: 1,
      cards: [{ id: "a", type: "accounts", size: "compact" }],
    });
    expect(result.cards[0].size).toBe(WIDGET_RULES.accounts.defaultSize);
  });

  it("replaces non-object config with an empty object", () => {
    const result = normalizeOverviewLayout({
      version: 1,
      cards: [{ id: "a", type: "accounts", config: "nope" }],
    });
    expect(result.cards[0].config).toEqual({});

    const arrayConfig = normalizeOverviewLayout({
      version: 1,
      cards: [{ id: "a", type: "accounts", config: [1, 2] }],
    });
    expect(arrayConfig.cards[0].config).toEqual({});
  });

  it("keeps an empty cards array as valid (user removed everything)", () => {
    const result = normalizeOverviewLayout({ version: 1, cards: [] });
    expect(result).toEqual({ version: 1, cards: [] });
  });
});

describe("availableToAdd", () => {
  it("lists every type when the layout is empty", () => {
    expect(availableToAdd(layoutWith([]))).toEqual(
      expect.arrayContaining([
        "insight",
        "budget-pulse",
        "accounts",
        "upcoming",
        "recent",
        "goals",
        "top-categories",
      ]),
    );
  });

  it("excludes a single-instance type once present", () => {
    const result = availableToAdd(
      layoutWith([{ id: "a", type: "accounts", size: "regular", config: {} }]),
    );
    expect(result).not.toContain("accounts");
  });

  it("keeps a `multiple: true` type available even when present", () => {
    const result = availableToAdd(
      layoutWith([{ id: "a", type: "goals", size: "regular", config: {} }]),
    );
    expect(result).toContain("goals");
  });
});

describe("serializeOverviewLayout", () => {
  it("round-trips through JSON.parse + normalizeOverviewLayout", () => {
    const serialized = serializeOverviewLayout(DEFAULT_OVERVIEW_LAYOUT);
    expect(normalizeOverviewLayout(JSON.parse(serialized))).toEqual(
      DEFAULT_OVERVIEW_LAYOUT,
    );
  });
});
