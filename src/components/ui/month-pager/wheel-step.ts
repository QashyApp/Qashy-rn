/** Web trackpad: horizontal wheel distance (px) that makes one step. */
export const WHEEL_STEP = 40;

/** What a wheel gesture has accumulated so far. */
export interface WheelGesture {
  /** Sideways distance since the last step (px, signed as the wheel reports it). */
  travelled: number;
  /** A step has been taken; the rest of the gesture (its inertia) is ignored until it goes quiet. */
  latched: boolean;
}

/** A gesture that has not started, or has been quiet long enough to be over. */
export const WHEEL_QUIET: WheelGesture = { travelled: 0, latched: false };

/** The pixels a wheel event travelled, whatever unit the browser reported it in. */
export function wheelPixels(deltaMode: number, delta: number) {
  return delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
}

/**
 * Feeds one sideways wheel delta (`dx`, px) into the gesture. Returns the gesture afterwards and the
 * step it made: `0` for none, otherwise `1` (a month forward) or `-1` (back). Content scrolling
 * toward the end reveals the next month, like a finger dragging that way, so `sign` flips it in
 * right-to-left locales. A step latches the gesture: a trackpad's inertia keeps events coming after
 * the fingers lift, and they belong to the gesture that already stepped. A slide in flight (`busy`)
 * ignores events altogether.
 */
export function wheelStep(
  gesture: WheelGesture,
  dx: number,
  sign: 1 | -1,
  busy: boolean,
): { gesture: WheelGesture; direction: -1 | 0 | 1 } {
  if (gesture.latched || busy) return { gesture, direction: 0 };
  const travelled = gesture.travelled + dx;
  if (Math.abs(travelled) < WHEEL_STEP) {
    return { gesture: { travelled, latched: false }, direction: 0 };
  }
  return {
    gesture: { travelled: 0, latched: true },
    direction: ((travelled > 0 ? 1 : -1) * sign) as 1 | -1,
  };
}
