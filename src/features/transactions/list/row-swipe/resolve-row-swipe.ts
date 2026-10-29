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
/** Past the commit line the row follows the finger at this fraction, so the commit feels held. */
export const COMMIT_RESISTANCE = 0.35;
/**
 * A destructive side (Delete) commits on a fling only from at least this fraction of the row's
 * width, and only at this release speed (dp/s). A flick that merely grazes the row can still open
 * it, but never erases it.
 */
export const DESTRUCTIVE_FLING_FRACTION = 0.3;
export const DESTRUCTIVE_FLING_VELOCITY = 1200;
/** The icon starts at this scale at rest and reaches full size at the commit line. */
export const ICON_REST_SCALE = 0.8;
/**
 * A touch moving this far sideways, and at least as far sideways as vertically, becomes a swipe;
 * this far vertically and farther than sideways it is a scroll. Together they make a +/-45 degree
 * cone around the horizontal.
 */
export const ACTIVATE_DISTANCE = 12;
/** Touches this close to a screen edge are left to the system back gesture... */
export const EDGE_GUARD = 24;
/** ...except a touch on the revealed button of an open row, which may start this close. */
export const EDGE_GUARD_OPEN_BUTTON = 16;

export interface RowSwipeSides {
  /** The start side has an action. */
  start: boolean;
  /** The end side has an action. */
  end: boolean;
}

export type RowSwipeSide = "start" | "end";

export type RowSwipeMove = "activate" | "fail" | "wait";

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
 * action follows the finger one to one up to the commit line, then at `COMMIT_RESISTANCE` (never
 * beyond the row's width); a side without one resists, so the row pulls a little and gives up.
 */
export function displayOffset(
  raw: number,
  rowWidth: number,
  isRtl: boolean,
  sides: RowSwipeSides,
  revealWidth: number = ROW_REVEAL_WIDTH,
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
  const line = commitDistance(rowWidth, revealWidth);
  const held =
    distance <= line ? distance : line + (distance - line) * COMMIT_RESISTANCE;
  return sign * Math.min(held, rowWidth);
}

/** How far toward the commit line a drawn offset is, from 0 (at rest) to 1 (at or past the line). */
export function commitProgress(
  offset: number,
  rowWidth: number,
  revealWidth: number,
): number {
  "worklet";
  const line = commitDistance(rowWidth, revealWidth);
  if (line <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(offset) / line));
}

/** The scale of an action icon at a drawn offset: `ICON_REST_SCALE` at rest, 1 at the commit line. */
export function iconScale(
  offset: number,
  rowWidth: number,
  revealWidth: number,
): number {
  "worklet";
  return (
    ICON_REST_SCALE +
    (1 - ICON_REST_SCALE) * commitProgress(offset, rowWidth, revealWidth)
  );
}

/**
 * What a finger that has moved (`dx`, `dy`) from where it landed means for the swipe: take the
 * touch (sideways, within 45 degrees of horizontal), give it up (a scroll) or keep waiting.
 */
export function classifyMove(dx: number, dy: number): RowSwipeMove {
  "worklet";
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x >= ACTIVATE_DISTANCE && x >= y) return "activate";
  if (y >= ACTIVATE_DISTANCE && y > x) return "fail";
  return "wait";
}

/**
 * Whether a touch at `absoluteX` is close enough to a screen edge to be the system back gesture's.
 * `openOffset` is the signed offset of the row that rests open (0 when none): its revealed button
 * is the strip of that width at the edge the row slid away from, and a touch on it may start a
 * little closer to the edge, so the button can be pressed or dragged shut.
 */
export function touchStartsAtEdge(
  absoluteX: number,
  windowWidth: number,
  openOffset: number,
): boolean {
  "worklet";
  const fromEdge = Math.min(absoluteX, windowWidth - absoluteX);
  if (fromEdge >= EDGE_GUARD) return false;
  const onButton =
    (openOffset > 0 && absoluteX < openOffset) ||
    (openOffset < 0 && absoluteX > windowWidth + openOffset);
  return !(onButton && fromEdge >= EDGE_GUARD_OPEN_BUTTON);
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
 *
 * `destructive` names the side whose action erases (Delete). A fling commits it only from at least
 * `DESTRUCTIVE_FLING_FRACTION` of the row's width and at `DESTRUCTIVE_FLING_VELOCITY`; a slower or
 * shorter flick opens it like any other drag. Past the commit line distance alone still commits.
 */
export function resolveRowSwipe(input: {
  offset: number;
  velocity: number;
  rowWidth: number;
  revealWidth: number;
  isRtl: boolean;
  sides: RowSwipeSides;
  destructive?: RowSwipeSide | null;
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
    const flingCommits =
      input.destructive === side
        ? outward >= DESTRUCTIVE_FLING_VELOCITY &&
          distance >=
            Math.max(rowWidth * DESTRUCTIVE_FLING_FRACTION, revealWidth)
        : distance >= revealWidth;
    return flingCommits
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
