import type { OverviewCard } from "@/domain/overview-layout";

/**
 * The cards shown while a reorder is still being saved: `cards` arranged by the ids in `order`.
 *
 * It only ever rearranges. If the saved cards stopped matching the pending order (one was added
 * or removed meanwhile) the pending order is ignored and the saved cards win, and a pending order
 * that equals the saved one returns `cards` itself so nothing re-renders for it.
 */
export function applyOptimisticOrder(
  cards: readonly OverviewCard[],
  order: readonly string[] | null,
): readonly OverviewCard[] {
  if (!order || order.length !== cards.length) return cards;
  const byId = new Map(cards.map((card) => [card.id, card] as const));
  if (byId.size !== cards.length) return cards;
  const arranged: OverviewCard[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const card = byId.get(id);
    if (!card || seen.has(id)) return cards;
    seen.add(id);
    arranged.push(card);
  }
  return arranged.every((card, index) => card === cards[index])
    ? cards
    : arranged;
}
