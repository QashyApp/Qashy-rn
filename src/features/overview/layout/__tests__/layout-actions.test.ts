import {
  DEFAULT_OVERVIEW_LAYOUT,
  type OverviewLayout,
} from "@/domain/overview-layout";
import { reduceLayoutAction } from "@/features/overview/layout/layout-actions";

const [A, B, C, D, E] = DEFAULT_OVERVIEW_LAYOUT.cards.map((card) => card.id);
const order = (layout: OverviewLayout) => layout.cards.map((card) => card.id);

describe("reduceLayoutAction: place", () => {
  it("puts the card in front of its anchor", () => {
    const next = reduceLayoutAction(DEFAULT_OVERVIEW_LAYOUT, {
      type: "place",
      id: E,
      toIndex: 0,
      beforeId: A,
    });
    expect(order(next)).toEqual([E, A, B, C, D]);
  });

  it("puts the card last when there is no anchor", () => {
    const next = reduceLayoutAction(DEFAULT_OVERVIEW_LAYOUT, {
      type: "place",
      id: A,
      toIndex: 4,
      beforeId: null,
    });
    expect(order(next)).toEqual([B, C, D, E, A]);
  });

  it("follows the anchor when the cards have shifted since the drop", () => {
    // Dropped as "between B and D" on a list where C had already been moved elsewhere.
    const shifted = reduceLayoutAction(DEFAULT_OVERVIEW_LAYOUT, {
      type: "move",
      id: C,
      toIndex: 4,
    });
    const next = reduceLayoutAction(shifted, {
      type: "place",
      id: E,
      toIndex: 2,
      beforeId: D,
    });
    expect(order(next)).toEqual([A, B, E, D, C]);
  });

  it("falls back to the index when the anchor is gone", () => {
    const next = reduceLayoutAction(DEFAULT_OVERVIEW_LAYOUT, {
      type: "place",
      id: E,
      toIndex: 1,
      beforeId: "removed",
    });
    expect(order(next)).toEqual([A, E, B, C, D]);
  });

  it("returns the same layout when the card is missing or already there", () => {
    expect(
      reduceLayoutAction(DEFAULT_OVERVIEW_LAYOUT, {
        type: "place",
        id: "nope",
        toIndex: 0,
        beforeId: A,
      }),
    ).toBe(DEFAULT_OVERVIEW_LAYOUT);
    expect(
      reduceLayoutAction(DEFAULT_OVERVIEW_LAYOUT, {
        type: "place",
        id: A,
        toIndex: 0,
        beforeId: B,
      }),
    ).toBe(DEFAULT_OVERVIEW_LAYOUT);
  });

  it("passes domain actions straight through", () => {
    expect(reduceLayoutAction(DEFAULT_OVERVIEW_LAYOUT, { type: "reset" })).toBe(
      DEFAULT_OVERVIEW_LAYOUT,
    );
  });
});
