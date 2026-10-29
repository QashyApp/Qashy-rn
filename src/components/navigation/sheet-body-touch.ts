/** A body drag starts once the finger has moved this far vertically (px), like the header's pan. */
export const BODY_ACTIVE_OFFSET = 10;
/** A mostly horizontal swipe (a chip row, a tab strip, a slider) is not a sheet drag. */
export const BODY_FAIL_OFFSET = 12;

export type BodyTouchDecision = "activate" | "fail" | "wait";

/**
 * Decides what the sheet body's pan does with a finger that has moved (`dx`, `dy`) px from where it
 * came down.
 *
 * The pan is activated by hand rather than by offsets so that the direction decides, not whichever
 * threshold a diagonal start happens to cross first: a mostly vertical move activates it, a mostly
 * horizontal one fails it and leaves the touch to the horizontal scroll view under the finger.
 * Neither before the finger has moved far enough to tell.
 */
export function classifyBodyTouch(dx: number, dy: number): BodyTouchDecision {
  // Runs on the UI thread, from the body pan's touch callbacks.
  "worklet";
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay >= BODY_ACTIVE_OFFSET && ay > ax) return "activate";
  if (ax >= BODY_FAIL_OFFSET && ax >= ay) return "fail";
  return "wait";
}
