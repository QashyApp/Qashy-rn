import {
  overviewLayoutReducer,
  type OverviewLayout,
  type OverviewLayoutAction,
} from "@/domain/overview-layout";

/**
 * A drop, anchored on the card that follows it rather than on an absolute index.
 *
 * A dropped card is replayed on the saved layout when an earlier save fails, and by then the
 * absolute index the user released on may point between different neighbours. Anchoring on the
 * card it was dropped in front of (`beforeId`, or `null` for the end of the list) lands it where
 * the user put it relative to what it sits beside. `toIndex` is the fallback when that neighbour
 * is gone from the layout it is replayed on.
 */
export interface PlaceCardAction {
  readonly type: "place";
  readonly id: string;
  readonly toIndex: number;
  readonly beforeId: string | null;
}

/** What the layout store accepts: every domain action, plus the anchored drop. */
export type LayoutStoreAction = OverviewLayoutAction | PlaceCardAction;

/** Same contract as `overviewLayoutReducer`: the same reference back when nothing changes. */
export function reduceLayoutAction(
  layout: OverviewLayout,
  action: LayoutStoreAction,
): OverviewLayout {
  if (action.type !== "place") return overviewLayoutReducer(layout, action);
  if (!layout.cards.some((card) => card.id === action.id)) return layout;
  const rest = layout.cards.filter((card) => card.id !== action.id);
  let toIndex = action.toIndex;
  if (action.beforeId === null) {
    toIndex = rest.length;
  } else {
    const at = rest.findIndex((card) => card.id === action.beforeId);
    if (at !== -1) toIndex = at;
  }
  return overviewLayoutReducer(layout, {
    type: "move",
    id: action.id,
    toIndex,
  });
}
