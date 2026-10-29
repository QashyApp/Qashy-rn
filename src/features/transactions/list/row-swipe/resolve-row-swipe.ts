/**
 * The arithmetic of a row swipe, pure and marked `worklet` so the gesture can run it on the UI
 * thread. Offsets and velocities are signed in screen space: positive is rightwards. The start side
 * is the right in a left-to-right layout and the left in a right-to-left one; the end side is the
 * other.
 */

/** How far a revealed action extends, in dp. */
export const ROW_REVEAL_WIDTH = 88;
/** A swipe past this fraction of the row's width commits the action. */
export const COMMIT_FRACTION = 0.5;
/** Never closer than this many reveal widths, so a narrow row cannot commit while still opening. */
const MIN_COMMIT_REVEALS = 1.25;
/** A released drag past this fraction of the reveal width settles open rather than closed. */
export const OPEN_FRACTION = 0.6;
/** Release speed (dp/s) at which direction wins over distance. */
export const FLING_VELOCITY = 600;
/** The farthest a side without an action can be pulled, in dp. */
export const RUBBER_LIMIT = 36;

export interface RowSwipeSides {
  /** The start side has an action. */
  start: boolean;
  /** The end side has an action. */
  end: boolean;
}

export type RowSwipeSide = "start" | "end";

export interface RowSwipeRelease {
  /** Where the row comes to rest when nothing commits. */
  settle: "closed" | "open-start" | "open-end";
  /** The action the release commits, if any. */
  commit: RowSwipeSide | null;
}

/** The sign (+1 or -1) of the offset that reveals the start side. */
export function startSign(isRtl: boolean): 1 | -1 {
  "worklet";
  return isRtl ? -1 : 1;
}

/** The side an offset reveals, or null while the row is at rest. */
export function sideOf(offset: number, isRtl: boolean): RowSwipeSide | null {
  "worklet";
  if (offset === 0) return null;
  return offset * startSign(isRtl) > 0 ? "start" : "end";
}

/** How far a swipe must travel to commit. */
export function commitDistance(rowWidth: number, revealWidth: number): number {
  "worklet";
  return Math.max(rowWidth * COMMIT_FRACTION, revealWidth * MIN_COMMIT_REVEALS);
}

function enabled(side: RowSwipeSide, sides: RowSwipeSides): boolean {
  "worklet";
  return side === "start" ? sides.start : sides.end;
}

/**
 * The offset the row is drawn at for a finger that has dragged it `raw` from rest. A side with an
 * action follows the finger up to the row's width; a side without one resists, so the row pulls
 * a little and gives up.
 */
export function displayOffset(
  raw: number,
  rowWidth: number,
  isRtl: boolean,
  sides: RowSwipeSides,
): number {
  "worklet";
  const side = sideOf(raw, isRtl);
  if (side === null) return 0;
  const distance = Math.abs(raw);
  const sign = raw < 0 ? -1 : 1;
  if (!enabled(side, sides)) {
    // 1 - 1/(1 + c*x/d), scaled by d: eases toward the limit and never reaches it.
    return (
      sign * RUBBER_LIMIT * (1 - 1 / (1 + (distance * 0.55) / RUBBER_LIMIT))
    );
  }
  return sign * Math.min(distance, rowWidth);
}

/** True once the offset is past the line where releasing would commit. */
export function isPastCommitLine(
  offset: number,
  rowWidth: number,
  revealWidth: number,
  isRtl: boolean,
  sides: RowSwipeSides,
): boolean {
  "worklet";
  const side = sideOf(offset, isRtl);
  if (side === null || !enabled(side, sides)) return false;
  return Math.abs(offset) >= commitDistance(rowWidth, revealWidth);
}

/**
 * What a released drag does. `offset` is where the row was drawn at release (the rubber-banded
 * value is fine: a side without an action never gets far enough to matter) and `velocity` the
 * finger's speed at that moment.
 *
 * A fling beats distance in either direction: outward past the reveal commits, outward before it
 * opens, and inward closes even from beyond the commit line. Otherwise distance decides.
 */
export function resolveRowSwipe(input: {
  offset: number;
  velocity: number;
  rowWidth: number;
  revealWidth: number;
  isRtl: boolean;
  sides: RowSwipeSides;
}): RowSwipeRelease {
  "worklet";
  const { offset, velocity, rowWidth, revealWidth, isRtl, sides } = input;
  const side = sideOf(offset, isRtl);
  if (side === null || !enabled(side, sides))
    return { settle: "closed", commit: null };
  const sign = offset < 0 ? -1 : 1;
  const distance = Math.abs(offset);
  // Positive when the finger is still travelling away from rest.
  const outward = velocity * sign;
  const open = side === "start" ? "open-start" : "open-end";

  if (outward <= -FLING_VELOCITY) return { settle: "closed", commit: null };
  if (distance >= commitDistance(rowWidth, revealWidth))
    return { settle: "closed", commit: side };
  if (outward >= FLING_VELOCITY) {
    return distance >= revealWidth
      ? { settle: "closed", commit: side }
      : distance >= revealWidth * 0.3
        ? { settle: open, commit: null }
        : { settle: "closed", commit: null };
  }
  return distance >= revealWidth * OPEN_FRACTION
    ? { settle: open, commit: null }
    : { settle: "closed", commit: null };
}

/** The offset a settled row rests at. */
export function settleOffset(
  settle: RowSwipeRelease["settle"],
  revealWidth: number,
  isRtl: boolean,
): number {
  "worklet";
  if (settle === "closed") return 0;
  const sign = startSign(isRtl);
  return settle === "open-start" ? sign * revealWidth : -sign * revealWidth;
}

/** The offset a committed row slides out to: all the way off the side it was pulled toward. */
export function commitOffset(
  side: RowSwipeSide,
  rowWidth: number,
  isRtl: boolean,
): number {
  "worklet";
  const sign = startSign(isRtl);
  return side === "start" ? sign * rowWidth : -sign * rowWidth;
}

/**
 * The row under `y` among rows sorted top to bottom with no overlap, or -1. Binary search, so a
 * touch-down can hit-test on the UI thread without walking every mounted row.
 */
export function findRowAt(
  tops: readonly number[],
  bottoms: readonly number[],
  y: number,
): number {
  "worklet";
  let low = 0;
  let high = tops.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (y < tops[mid]) high = mid - 1;
    else if (y >= bottoms[mid]) low = mid + 1;
    else return mid;
  }
  return -1;
}
