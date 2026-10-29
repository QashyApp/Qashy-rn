import {
  overviewLayoutReducer,
  type OverviewCard,
  type OverviewLayoutAction,
} from "@/domain/overview-layout";

/**
 * Applies a dropped card's new order at once and saves it behind the scenes.
 *
 * `getCards` returns the cards as shown (including any order still pending), `setPendingOrder`
 * shows an order before it is saved, and `save` persists an action and resolves to whether it
 * was saved (it reports its own errors). The returned function takes the dropped card and its
 * target index and returns whether the order changed at all.
 *
 * The pending order is dropped when the save settles, either way: on success the saved layout
 * has caught up, on failure the card goes back. Only the newest drop clears it, so a slow earlier
 * save settling never pulls a later drop back.
 */
export function createCardDropper({
  getCards,
  setPendingOrder,
  save,
}: {
  getCards: () => readonly OverviewCard[];
  setPendingOrder: (order: readonly string[] | null) => void;
  save: (action: OverviewLayoutAction) => Promise<boolean>;
}): (id: string, toIndex: number) => boolean {
  let sequence = 0;
  return (id, toIndex) => {
    const shown = getCards();
    const action: OverviewLayoutAction = { type: "move", id, toIndex };
    const next = overviewLayoutReducer({ version: 1, cards: shown }, action);
    if (next.cards.every((card, index) => card === shown[index])) return false;
    sequence += 1;
    const mine = sequence;
    setPendingOrder(next.cards.map((card) => card.id));
    void save(action).then(() => {
      if (sequence === mine) setPendingOrder(null);
    });
    return true;
  };
}
