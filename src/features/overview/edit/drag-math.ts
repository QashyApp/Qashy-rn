/**
 * Pure geometry for dragging an Overview card to a new position in edit mode.
 *
 * Everything here runs on the UI thread while a finger is down (hence the `worklet`
 * directives), so it takes and returns plain numbers and arrays only. The owning screen measures
 * every card's height; the slots below are derived from those heights and the stack's gap, so
 * they never depend on a layout pass having finished after a reorder.
 */

/** Where one card sits in the edit stack, in the stack's own coordinates. */
export interface CardSlot {
  readonly top: number;
  readonly height: number;
}

/** How close to the top or bottom of the scroll viewport the finger starts scrolling the page. */
export const AUTO_SCROLL_EDGE = 80;
/** The most the page scrolls per 16ms frame, at the very edge of the viewport. */
export const AUTO_SCROLL_MAX_STEP = 14;

/** Lays heights out top to bottom with `gap` between neighbours. */
export function slotsFromHeights(
  heights: readonly number[],
  gap: number,
): CardSlot[] {
  "worklet";
  const slots: CardSlot[] = [];
  let top = 0;
  for (let index = 0; index < heights.length; index += 1) {
    slots.push({ top, height: heights[index] });
    top += heights[index] + gap;
  }
  return slots;
}

/**
 * The index the dragged card would take if dropped now: how many of the other cards have their
 * midpoint above the dragged card's midpoint (`draggedCenter`, in the same coordinates as the
 * slots). Dropping where it started yields `fromIndex`.
 */
export function dropTargetIndex(
  slots: readonly CardSlot[],
  fromIndex: number,
  draggedCenter: number,
): number {
  "worklet";
  let target = 0;
  for (let index = 0; index < slots.length; index += 1) {
    if (index === fromIndex) continue;
    const slot = slots[index];
    if (slot.top + slot.height / 2 < draggedCenter) target += 1;
  }
  return target;
}

/**
 * Where a card being dragged would land, from its own slot plus how far it has travelled: the
 * finger's drag (`panY`) and however far the page has scrolled since the drag began
 * (`scrollY - scrollAtStart`, since the slots move with the content). -1 when no drag is live
 * (`phase` is not 1) or the card has no slot yet.
 */
export function resolveDropTarget({
  phase,
  slots,
  index,
  panY,
  scrollY,
  scrollAtStart,
}: {
  phase: number;
  slots: readonly CardSlot[];
  index: number;
  panY: number;
  scrollY: number;
  scrollAtStart: number;
}): number {
  "worklet";
  if (phase !== 1) return -1;
  const own = slots[index];
  if (!own) return -1;
  const travelled = panY + scrollY - scrollAtStart;
  return dropTargetIndex(slots, index, own.top + own.height / 2 + travelled);
}

/**
 * The y of the centre of the insertion line for a drag from `fromIndex` to `toIndex`: just above
 * the card the dragged one would move in front of, or just below the card it would move behind.
 * Null when there is nothing to show (no drag, or the card would stay where it is).
 */
export function insertionLineY(
  slots: readonly CardSlot[],
  fromIndex: number,
  toIndex: number,
  gap: number,
): number | null {
  "worklet";
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
  const slot = slots[toIndex];
  if (!slot) return null;
  return toIndex < fromIndex
    ? slot.top - gap / 2
    : slot.top + slot.height + gap / 2;
}

/**
 * How far to scroll the page this frame while a card is held near an edge: negative scrolls up,
 * positive scrolls down, zero when the finger is clear of both edges. The step eases in with the
 * square of how deep into the edge zone the finger is, and is capped at `maxStep`.
 */
export function autoScrollStep(
  fingerY: number,
  viewportTop: number,
  viewportHeight: number,
  edge: number = AUTO_SCROLL_EDGE,
  maxStep: number = AUTO_SCROLL_MAX_STEP,
): number {
  "worklet";
  if (viewportHeight <= 0) return 0;
  // On a very short viewport the two zones must not overlap.
  const zone = Math.min(edge, viewportHeight / 3);
  const intoTop = viewportTop + zone - fingerY;
  if (intoTop > 0) {
    const depth = Math.min(intoTop / zone, 1);
    return -maxStep * depth * depth;
  }
  const intoBottom = fingerY - (viewportTop + viewportHeight - zone);
  if (intoBottom > 0) {
    const depth = Math.min(intoBottom / zone, 1);
    return maxStep * depth * depth;
  }
  return 0;
}

/** Keeps a scroll offset inside the content. */
export function clampScroll(offset: number, maxOffset: number): number {
  "worklet";
  return Math.max(0, Math.min(maxOffset, offset));
}
