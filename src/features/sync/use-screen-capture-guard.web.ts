/**
 * Web implementation of the screen-capture guard.
 *
 * Browsers have no equivalent of the OS screen capture or app-switcher blocks, so this is a no-op.
 */

export function usePreventScreenCaptureWhile(
  _active: boolean,
  _key: string,
  _onFailure?: () => void,
) {
  // Nothing to wait for: there is no block to apply, so the guard is trivially "ready".
  return true;
}
