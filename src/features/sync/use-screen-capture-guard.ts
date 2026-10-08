/**
 * Fallback and TypeScript declaration for environments where neither platform suffix applies
 * (e.g. Node.js unit tests).
 */

export function usePreventScreenCaptureWhile(
  _active: boolean,
  _key: string,
  _onFailure?: () => void,
) {}
