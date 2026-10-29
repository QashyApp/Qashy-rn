/** How far ahead of the finger a release is projected, in seconds of its current velocity. */
const PROJECTION_SECONDS = 0.15;

export type SheetRelease =
  { kind: "dismiss" } | { kind: "snap"; detent: "collapsed" | "expanded" };

/**
 * Decides where a bottom sheet settles when a drag is released.
 *
 * `visible` is how much of the sheet is on screen at release; `velocityY` is positive when the
 * finger moves down, in px/s. The release is projected a little ahead along its velocity, so a quick
 * flick counts for more than where the finger happened to stop. A sheet pulled below half of its
 * collapsed height dismisses; otherwise it settles on the nearer detent.
 */
export function resolveSheetRelease({
  visible,
  velocityY,
  collapsed,
  expanded,
}: {
  visible: number;
  velocityY: number;
  collapsed: number;
  expanded: number;
}): SheetRelease {
  // Runs on the UI thread, from the sheet's drag gesture.
  "worklet";
  const projected = visible - velocityY * PROJECTION_SECONDS;
  if (projected < collapsed / 2) return { kind: "dismiss" };
  const midpoint = (collapsed + expanded) / 2;
  return {
    kind: "snap",
    detent:
      expanded > collapsed && projected > midpoint ? "expanded" : "collapsed",
  };
}

/**
 * The spring a sheet rises on: a damped spring's step response with the envelope decayed to
 * about 0.06% by `durationMs`, clamped at the target so the sheet never lifts off the bottom edge.
 * It leaves at once and settles softly, where a symmetric curve spends its first frames barely
 * moving, which reads as a delay.
 */
export function sheetSpring(dampingRatio: number, durationMs: number) {
  const omega = 7.5 / (dampingRatio * (durationMs / 1000));
  return {
    mass: 1,
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
    overshootClamping: true,
  } as const;
}

/** The quickest and slowest a swiped-away sheet takes to leave, in ms. */
const DISMISS_MIN_MS = 120;
const DISMISS_MAX_MS = 240;
/**
 * Below this release speed (px/s) the sheet is not being thrown, only let go of: it leaves on the
 * accelerating exit curve, and the duration is worked out as if it were moving at this speed.
 */
export const DISMISS_SLOW_SPEED = 400;

/**
 * How a sheet leaves after a swipe down: `remaining` px still to cover and the release speed
 * `velocityY` (px/s, positive downward). A thrown sheet carries on at the speed it was released at
 * (`linear` true: an accelerating curve would stall it for the first frames), a sheet merely let go
 * of takes the exit curve. Either way the time is the distance over that speed, kept within
 * [120, 240] ms so a long throw is not abrupt and a lazy drop is not sluggish.
 */
export function sheetDismissTiming(remaining: number, velocityY: number) {
  // Runs on the UI thread, from the sheet's drag gesture.
  "worklet";
  const speed = Math.max(velocityY, DISMISS_SLOW_SPEED);
  const ms = (Math.max(remaining, 0) / speed) * 1000;
  return {
    duration: Math.round(
      Math.min(DISMISS_MAX_MS, Math.max(DISMISS_MIN_MS, ms)),
    ),
    linear: velocityY > DISMISS_SLOW_SPEED,
  };
}
