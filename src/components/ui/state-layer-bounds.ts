import { createContext, useContext } from "react";

/**
 * How far a full-width row may extend its state layer into the padding of the container it sits
 * in.
 *
 * A list container that clips its children (`Card variant="list"`, the ledger's day slab)
 * publishes one of these for each row: the wash then reaches the container's edges and takes the
 * container's rounded corners from its own clip, instead of drawing a rectangle inside it.
 * `x` is the container's horizontal padding and applies to every row; `top` and `bottom` are its
 * vertical padding, which only the first and last row extend into.
 */
export interface StateLayerBounds {
  x: number;
  top: number;
  bottom: number;
}

/** `null` outside a clipping list container. Read by `MotionPressable` only. */
export const StateLayerBoundsContext = createContext<StateLayerBounds | null>(
  null,
);

/** The nearest clipping list container's padding, or `null` on a plain surface. */
export function useStateLayerBounds(): StateLayerBounds | null {
  return useContext(StateLayerBoundsContext);
}
