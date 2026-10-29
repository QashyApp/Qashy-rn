/** Fraction of the page width a slow drag has to cover before it commits. */
export const SWIPE_COMMIT_FRACTION = 0.25;
/** Release speed (dp/s) above which a flick commits regardless of distance. */
export const SWIPE_COMMIT_VELOCITY = 850;
/**
 * The least a flick must have travelled to commit. A finger that lands, jitters and lifts reports
 * a large velocity over a few pixels; that is a tap, not a swipe.
 */
export const SWIPE_FLICK_MIN_TRAVEL = 28;
/** How far a pan moves sideways before it becomes a swipe (and, vertically, a scroll). */
export const SWIPE_ACTIVE_OFFSET = 14;

/** Whether a release is a flick: fast enough, and having travelled far enough to not be a tap. */
function isFlick(dx: number, vx: number) {
  "worklet";
  return (
    Math.abs(vx) >= SWIPE_COMMIT_VELOCITY &&
    Math.abs(dx) >= SWIPE_FLICK_MIN_TRAVEL
  );
}

/**
 * Decides what a released month swipe does: `1` to step forward a month, `-1` to
 * step back, `0` to spring back to where it started.
 *
 * A drag commits past a quarter of the page width, or after a few dp of travel
 * when the release was a flick. A flick's own direction wins over the net drag, so dragging
 * one way and flicking back the other reads as "never mind". Dragging toward the
 * end edge reveals the next month (flipped in right-to-left locales); stepping
 * forward is refused when `canForward` is false, and stepping back is always allowed.
 *
 * Pure and marked `worklet` so the pager can call it on the UI thread at release.
 */
export function resolveSwipe(
  dx: number,
  vx: number,
  width: number,
  canForward: boolean,
  isRtl: boolean,
): -1 | 0 | 1 {
  "worklet";
  const flick = isFlick(dx, vx);
  const far = width > 0 && Math.abs(dx) >= width * SWIPE_COMMIT_FRACTION;
  if (!flick && !far) return 0;
  const lead = flick ? vx : dx;
  if (lead === 0) return 0;
  // LTR: finger moving left (negative) reveals the next month. RTL: moving right does.
  const forward = lead > 0 === isRtl;
  if (forward) return canForward ? 1 : 0;
  return -1;
}

/**
 * Decides what a released drag does when it did not begin at rest. `start` is the pages' offset
 * (`translateX`) when the finger landed, `dx` how far this finger travelled and `vx` its release
 * velocity. The pages are decided at `start + dx`, as `resolveSwipe` would, with one rule on top:
 * a release never commits against the finger. Grabbing a slide mid-way leaves a residual offset
 * (the landed month sits partway across), and a slow drag the same way as that slide must not
 * resolve from the absolute position into the month before it. A commit that would go against the
 * finger's own travel (its velocity for a flick, its distance otherwise) settles on the nearest page
 * on the finger's side instead, so the drag completes toward the month it was heading to.
 *
 * With `start` at 0 this is exactly `resolveSwipe(dx, vx, ...)`. Pure and marked `worklet`.
 */
export function resolveRelease(
  start: number,
  dx: number,
  vx: number,
  width: number,
  canForward: boolean,
  isRtl: boolean,
): -1 | 0 | 1 {
  "worklet";
  const raw = start + dx;
  const decided = resolveSwipe(raw, vx, width, canForward, isRtl);
  if (decided === 0) return 0;
  const sign = isRtl ? -1 : 1;
  const finger = Math.sign(Math.abs(vx) >= SWIPE_COMMIT_VELOCITY ? vx : dx);
  // Where the pages are on screen (the drag is clamped to one page either way).
  const position = Math.max(-width, Math.min(width, raw));
  const target = -decided * sign * width;
  if (finger === 0 || Math.sign(target - position) !== -finger) return decided;
  // Against the finger: the nearest page that is not.
  let best: -1 | 0 | 1 = 0;
  let bestDistance = Infinity;
  for (const candidate of [1, 0, -1] as const) {
    if (candidate === 1 && !canForward) continue;
    const at = -candidate * sign * width;
    // Only pages at or beyond the pages' position in the direction the finger moved.
    if ((at - position) * finger < 0) continue;
    const distance = Math.abs(at - position);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The spring a committed swipe settles on: the theme's own stiffness and mass, damped critically.
 * Underdamped and clamped, a spring reaches its target for the first time at speed and stops dead,
 * which reads as a linear slide with a hard stop. Critically damped, the pages decelerate into
 * place and never overshoot. Springing back to where the drag began keeps the theme's own spring.
 */
export function commitSpring(spring: {
  damping: number;
  stiffness: number;
  mass: number;
}) {
  return {
    ...spring,
    damping: 2 * Math.sqrt(spring.stiffness * spring.mass),
  };
}
