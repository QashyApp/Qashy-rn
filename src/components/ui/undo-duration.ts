/** The least time (ms) an undo bar stays for a screen-reader user, who has to find it first. */
export const SCREEN_READER_UNDO_MS = 10_000;
/** The least time (ms) left once a finger or focus lets go of the bar: enough to act on it. */
export const RESUME_UNDO_MS = 2_000;

/**
 * How long an undo bar stays: the call site's own `duration`, but never less than ten seconds while
 * a screen reader is running (hearing the announcement, finding the button and double-tapping it
 * takes longer than a glance does).
 */
export function undoDuration(duration: number, screenReader: boolean) {
  return screenReader ? Math.max(duration, SCREEN_READER_UNDO_MS) : duration;
}

/** What is left of the countdown after it ran for `elapsed` ms, never less than `RESUME_UNDO_MS`. */
export function undoRemaining(remaining: number, elapsed: number) {
  return Math.max(RESUME_UNDO_MS, remaining - elapsed);
}
