import { packOverviewRows } from "@/features/overview/widgets/grid";
import type { OverviewCard } from "@/features/overview/layout/overview-layout";

const card = (id: string, size: OverviewCard["size"]): OverviewCard => ({
  id,
  type: "accounts",
  size,
  config: {},
});

describe("packOverviewRows", () => {
  it("returns nothing for an empty layout", () => {
    expect(packOverviewRows([], 1200, 20)).toEqual([]);
  });

  it("puts every card in its own full-width row below the grid breakpoint", () => {
    const cards = [
      card("a", "wide"),
      card("b", "compact"),
      card("c", "regular"),
    ];
    const rows = packOverviewRows(cards, 899, 20);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.cards).toHaveLength(1);
      expect(row.cards[0].width).toBe(899);
    }
  });

  it("packs a wide card alone in a row at or above the breakpoint", () => {
    const cards = [card("a", "wide"), card("b", "regular")];
    const rows = packOverviewRows(cards, 1200, 20);
    expect(rows).toHaveLength(2);
    expect(rows[0].cards.map((c) => c.id)).toEqual(["a"]);
    expect(rows[1].cards.map((c) => c.id)).toEqual(["b"]);
  });

  it("packs two regular cards (3 columns each) into one row", () => {
    const cards = [card("a", "regular"), card("b", "regular")];
    const rows = packOverviewRows(cards, 1200, 20);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards.map((c) => c.id)).toEqual(["a", "b"]);
    // Two equal 3-column cards should be equal width.
    expect(rows[0].cards[0].width).toBeCloseTo(rows[0].cards[1].width);
  });

  it("packs three compact cards (2 columns each) into one row", () => {
    const cards = [
      card("a", "compact"),
      card("b", "compact"),
      card("c", "compact"),
    ];
    const rows = packOverviewRows(cards, 1200, 20);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(3);
  });

  it("wraps to a new row when a card would exceed the remaining columns", () => {
    // regular (3) + regular (3) = 6 fits; a third regular must wrap.
    const cards = [
      card("a", "regular"),
      card("b", "regular"),
      card("c", "regular"),
    ];
    const rows = packOverviewRows(cards, 1200, 20);
    expect(rows).toHaveLength(2);
    expect(rows[0].cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(rows[1].cards.map((c) => c.id)).toEqual(["c"]);
  });

  it("mixes compact and regular cards up to 6 columns per row", () => {
    // compact(2) + regular(3) = 5, still room for nothing else this size; another compact(2) wraps.
    const cards = [
      card("a", "compact"),
      card("b", "regular"),
      card("c", "compact"),
    ];
    const rows = packOverviewRows(cards, 1200, 20);
    expect(rows).toHaveLength(2);
    expect(rows[0].cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(rows[1].cards.map((c) => c.id)).toEqual(["c"]);
  });

  it("computes widths that sum with gaps to the content width for a full row", () => {
    const cards = [card("a", "regular"), card("b", "regular")];
    const rows = packOverviewRows(cards, 1200, 20);
    const [first, second] = rows[0].cards;
    expect(first.width + second.width + 20).toBeCloseTo(1200);
  });

  it("honours an explicit multiColumn even when layoutWidth alone would fall below the breakpoint", () => {
    // The screen may decide "wide layout" from a larger number (e.g. contentWidth) than the
    // pixel budget cards are actually packed into (e.g. a measured container capped narrower by
    // the caller's own max-width) — `multiColumn` decouples the two so a smaller `layoutWidth`
    // still forces the 6-column flow instead of stacking.
    const cards = [card("a", "regular"), card("b", "regular")];
    const rows = packOverviewRows(cards, 864, 20, { multiColumn: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].cards.map((c) => c.id)).toEqual(["a", "b"]);
    const [first, second] = rows[0].cards;
    // Floored widths must never sum past the actual pixel budget they were computed from.
    expect(first.width + second.width + 20).toBeLessThanOrEqual(864);
    expect(Number.isInteger(first.width)).toBe(true);
    expect(Number.isInteger(second.width)).toBe(true);
  });

  it("honours an explicit multiColumn: false even at or above the breakpoint", () => {
    const cards = [card("a", "regular"), card("b", "regular")];
    const rows = packOverviewRows(cards, 1200, 20, { multiColumn: false });
    expect(rows).toHaveLength(2);
    expect(rows[0].cards[0].width).toBe(1200);
  });
});
