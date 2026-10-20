/**
 * Asks the native side to publish the widget picker previews, at most once per process.
 *
 * The native side does the work only when the previews are out of date (a new preview version, app
 * version or language), and leaves a rate-limited attempt unmarked so the next launch retries it.
 * So this needs no retry of its own, and asking again within one process could not change the
 * answer. Never rejects: a failure can only cost the preview.
 */

let requested = false;

/** True when this call made the request, false when the process had already asked. */
export function requestPreviewRegistration(
  register: () => Promise<unknown>,
): boolean {
  if (requested) return false;
  requested = true;
  void register().catch(() => undefined);
  return true;
}
