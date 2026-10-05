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
