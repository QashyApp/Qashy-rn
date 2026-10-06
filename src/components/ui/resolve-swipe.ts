/** Fraction of the page width a slow drag has to cover before it commits. */
export const SWIPE_COMMIT_FRACTION = 0.25;
/** Release speed (px/s) above which a flick commits regardless of distance. */
export const SWIPE_COMMIT_VELOCITY = 600;

/**
 * Decides what a released month swipe does: `1` to step forward a month, `-1` to
 * step back, `0` to spring back to where it started.
 *
 * A drag commits past a quarter of the page width, or at any distance when the
 * release was a flick. A flick's own direction wins over the net drag, so dragging
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
  const flick = Math.abs(vx) >= SWIPE_COMMIT_VELOCITY;
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
