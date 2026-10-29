/**
 * The pager's arithmetic, kept apart from the gesture and animation plumbing so it can be tested.
 * Every function is pure and marked `worklet`: the pager calls them on the UI thread.
 */

/** Where a page sits on screen: its slot from the centre month, plus the pages' drag offset. */
export function pagePosition(
  index: number,
  baseIndex: number,
  sign: 1 | -1,
  width: number,
  translateX: number,
) {
  "worklet";
  return (index - baseIndex) * sign * width + translateX;
}

/**
 * The pages' offset once a slide toward `direction` has landed and the centre month has moved on
 * by one. It is re-based, not reset: every page keeps exactly the position it had on screen, so a
 * slide that is grabbed (or cut short by the next tap) mid-way does not jump. What is left over is
 * the residual offset the next drag or slide starts from.
 */
export function landedOffset(
  translateX: number,
  direction: 1 | -1,
  sign: 1 | -1,
  width: number,
) {
  "worklet";
  return translateX + direction * sign * width;
}

/**
 * Whether a step toward `direction` may be taken: forward is refused once the slide in flight
 * (`inFlight`, `0` when there is none) has carried the centre to the newest month. Back is always
 * allowed.
 */
export function canStep(
  direction: 1 | -1,
  baseIndex: number,
  inFlight: number,
  maxIndex: number,
) {
  "worklet";
  return direction < 0 || baseIndex + inFlight + 1 <= maxIndex;
}
