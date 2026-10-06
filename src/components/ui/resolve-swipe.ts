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

/** Past the newest allowed month the pages barely follow the finger. */
export const BLOCKED_FOLLOW = 0.12;
/** Stands in for "no newest month" on the UI thread, where `Infinity` is avoided. */
export const NO_MAX_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * A month's position on a continuous axis (`YYYY-MM…` to `year * 12 + month`), so neighbouring
 * months are exactly one apart. The pager animates this axis rather than a pixel offset.
 */
export function monthIndex(month: string): number {
  "worklet";
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
}

/** The first day (`YYYY-MM-01`) of the month at `index` on the {@link monthIndex} axis. */
export function monthFromIndex(index: number): string {
  "worklet";
  const zeroBased = Math.round(index) - 1;
  const year = Math.floor(zeroBased / 12);
  const month = zeroBased - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${month < 10 ? "0" : ""}${month}-01`;
}

/**
 * Where the pager sits while a finger drags it, on the {@link monthIndex} axis: the finger's
 * travel in page widths from where the drag began, never more than one month either side of
 * `anchor` (the month the pager is resting on or settling into), and barely following past
 * `maxIndex`.
 */
export function followPosition(
  start: number,
  translationX: number,
  width: number,
  isRtl: boolean,
  anchor: number,
  maxIndex: number,
): number {
  "worklet";
  if (width <= 0) return start;
  // LTR: a finger moving left (negative) brings the next month in. RTL: moving right does.
  const raw = start - (translationX * (isRtl ? -1 : 1)) / width;
  const followed =
    raw > maxIndex ? maxIndex + (raw - maxIndex) * BLOCKED_FOLLOW : raw;
  return Math.max(anchor - 1, Math.min(anchor + 1, followed));
}

/**
 * The drag distance (px, same sign convention as `translationX`) a release is judged on.
 *
 * `fromAnchor` is how far the pages sit from the month they rest on or are settling into, and
 * `translation` is how far this finger moved. Normally the whole offset counts, so a spring-back
 * grabbed mid-way and pushed on keeps the distance the earlier drag already covered. A committed
 * slide grabbed mid-way (`caughtSlide`) still has the rest of its own travel ahead of it; that
 * remainder is not the finger's doing, so only the new finger travel counts and catching a slide
 * never reads as a swipe back.
 */
export function swipeDisplacement(
  fromAnchor: number,
  translation: number,
  caughtSlide: boolean,
): number {
  "worklet";
  return caughtSlide ? translation : fromAnchor;
}
