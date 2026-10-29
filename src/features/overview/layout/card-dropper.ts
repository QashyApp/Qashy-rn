import {
  overviewLayoutReducer,
  type OverviewCard,
} from "@/domain/overview-layout";
import type { PlaceCardAction } from "@/features/overview/layout/layout-actions";

/**
 * Turns a dropped card into a save.
 *
 * `getCards` returns the cards as shown (the store's optimistic order, which already includes
 * every drop still being saved), and `save` persists an action and resolves to whether it was
 * saved (it reports its own errors and never rejects). The returned function takes the dropped
 * card and its target index and returns `null` when the drop would not change the order, else
 * the save's promise.
 *
 * Nothing is held here: the shown order comes from the store, which shows a drop at once, keeps
 * it until the save settles and takes it back if the save fails.
 */
export function createCardDropper({
  getCards,
  save,
}: {
  getCards: () => readonly OverviewCard[];
  save: (action: PlaceCardAction) => Promise<boolean>;
}): (id: string, toIndex: number) => Promise<boolean> | null {
  return (id, toIndex) => {
    const shown = getCards();
    const next = overviewLayoutReducer(
      { version: 1, cards: shown },
      { type: "move", id, toIndex },
    );
    if (next.cards.every((card, index) => card === shown[index])) return null;
    const at = next.cards.findIndex((card) => card.id === id);
    return save({
      type: "place",
      id,
      toIndex: at,
      beforeId: next.cards[at + 1]?.id ?? null,
    });
  };
}
