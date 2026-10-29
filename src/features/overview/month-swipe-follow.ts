/**
 * How the Overview card stack follows a month swipe.
 *
 * The month pager does not slide the page on this screen (only the month title and the changing
 * figures move), so the card stack leans a little toward the finger and dims as the swipe
 * progresses. `drag` is the swipe in page widths relative to the month the page shows: 0 at
 * rest, +-1 once the neighbouring month has fully arrived.
 */

/** The opacity at a completed swipe; matches where the month content fade picks up from. */
export const SWIPE_FOLLOW_MIN_OPACITY = 0.3;
/** How much of the finger's travel the cards follow. */
export const SWIPE_FOLLOW_TRAVEL = 0.3;

/**
 * `travel`: lean and dim. `fade`: dim only (the in-app Minimal level, which allows no travel).
 * `none`: stay put (reduced motion, or the Off level).
 */
export type SwipeFollowMode = "travel" | "fade" | "none";

export function monthSwipeFollow(
  drag: number,
  pageWidth: number,
  mode: SwipeFollowMode,
): { translateX: number; opacity: number } {
  "worklet";
  if (mode === "none") return { translateX: 0, opacity: 1 };
  const progress = Math.max(-1, Math.min(1, drag));
  const depth = Math.abs(progress);
  const opacity = 1 - (1 - SWIPE_FOLLOW_MIN_OPACITY) * depth;
  if (mode === "fade") return { translateX: 0, opacity };
  // The lean tapers back to nothing as the swipe completes, so the cards are already home when
  // the new month's content replaces them.
  const translateX =
    progress * pageWidth * SWIPE_FOLLOW_TRAVEL * (1 - depth * depth);
  return { translateX, opacity };
}
