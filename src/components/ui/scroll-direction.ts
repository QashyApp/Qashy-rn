/**
 * A scroll direction that has to prove itself. A list scrolled by hand reports jittery deltas, and a
 * fling that settles reports tiny reversals; reacting to each one made the floating button flicker.
 * The distance travelled since the direction last changed is accumulated instead, and only a
 * direction that has gone `FLIP_DISTANCE` dp counts as a change.
 */
export const FLIP_DISTANCE = 20;

/** Signed distance (dp) scrolled since the direction last changed: positive is down the list. */
export type ScrollTravel = number;

/**
 * Adds one scroll delta to the running `travel`. A delta against the grain starts a fresh run, so
 * a long scroll down followed by a slight twitch up is not "up" until it has gone 20 dp up.
 */
export function accumulateTravel(travel: ScrollTravel, delta: number) {
  if (delta === 0) return travel;
  return Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
}

/** `1` once the run has gone `distance` dp down, `-1` once it has gone that far up, else `0`. */
export function travelDirection(
  travel: ScrollTravel,
  distance: number = FLIP_DISTANCE,
): -1 | 0 | 1 {
  if (travel >= distance) return 1;
  if (travel <= -distance) return -1;
  return 0;
}
