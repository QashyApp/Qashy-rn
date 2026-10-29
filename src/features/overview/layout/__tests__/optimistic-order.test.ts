import type { OverviewCard } from "@/domain/overview-layout";
import { applyOptimisticOrder } from "@/features/overview/layout/optimistic-order";

const card = (id: string): OverviewCard => ({
  id,
  type: "accounts",
  size: "regular",
  config: {},
});

const cards = [card("a"), card("b"), card("c")];

describe("applyOptimisticOrder", () => {
  it("returns the saved cards when nothing is pending", () => {
    expect(applyOptimisticOrder(cards, null)).toBe(cards);
  });

  it("arranges the saved cards by the pending ids", () => {
    const shown = applyOptimisticOrder(cards, ["c", "a", "b"]);
    expect(shown.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    // The saved card objects, so a resize or configure made meanwhile still shows.
    expect(shown[0]).toBe(cards[2]);
  });

  it("returns the same array once the saved order has caught up", () => {
    expect(applyOptimisticOrder(cards, ["a", "b", "c"])).toBe(cards);
  });

  it("ignores a pending order that no longer matches the saved cards", () => {
    expect(applyOptimisticOrder(cards, ["c", "a"])).toBe(cards);
    expect(applyOptimisticOrder(cards, ["c", "a", "x"])).toBe(cards);
    expect(applyOptimisticOrder(cards, ["a", "a", "b"])).toBe(cards);
    expect(applyOptimisticOrder(cards.slice(0, 2), ["c", "a", "b"])).toEqual(
      cards.slice(0, 2),
    );
  });
});
