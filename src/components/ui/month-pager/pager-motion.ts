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

/** The most landed-but-not-yet-rendered months the trail remembers; older ones are forgotten. */
export const LANDED_TRAIL_LIMIT = 32;

/** The trail with `index` (a month a slide has just landed on) appended, oldest dropped past the limit. */
export function pushLanded(trail: readonly number[], index: number): number[] {
  "worklet";
  const next = [...trail, index];
  return next.length > LANDED_TRAIL_LIMIT
    ? next.slice(next.length - LANDED_TRAIL_LIMIT)
    : next;
}

/** What a React render of a month means for the pager. */
export interface RenderVerdict {
  /**
   * A month the pager never landed on: a jump made elsewhere (the picker, a deep link, a parent
   * that answered with another month). The pages must be put on it.
   */
  external: boolean;
  /** No landed slide is still waiting to be rendered. */
  caughtUp: boolean;
  /** The landed months still waiting to be rendered. */
  trail: number[];
}

/**
 * Judges a render of month `index` against the trail of months slides have landed on and React has
 * not rendered yet, oldest first. React renders them in the order they were asked for, but not
 * always each one: a render found in the trail is this pager's own and retires itself and every
 * older entry, however many slides have landed since (those follow, so it must not move the
 * pages). A render that is not in the trail is an outside jump, wherever it falls relative to the
 * slides in flight, and clears the trail. A month that appears twice (forward, back, forward) is
 * matched at its oldest entry, the render that comes first.
 */
export function judgeRender(
  index: number,
  trail: readonly number[],
): RenderVerdict {
  "worklet";
  const at = trail.indexOf(index);
  if (at < 0) return { external: true, caughtUp: true, trail: [] };
  const rest = trail.slice(at + 1);
  return { external: false, caughtUp: rest.length === 0, trail: rest };
}
