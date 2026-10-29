import { useCallback, useEffect, useRef } from "react";

/**
 * Opens the Change category sheet for a row, after the row's confirming hold when it has one.
 *
 * A second request while the first still waits on its hold does not swallow it: the first opens
 * now, and the second follows once its own hold is over. `cancel` drops whatever is waiting (the
 * screen lost focus, so the sheet would open over another screen); so does unmounting.
 */
export function useCategorySheetRequest(open: (id: string) => void) {
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    id: string;
  } | null>(null);
  const cancel = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const request = useCallback(
    (id: string, holdMs?: number) => {
      const earlier = pending.current;
      cancel();
      if (earlier) open(earlier.id);
      if (holdMs === undefined || holdMs <= 0) {
        open(id);
        return;
      }
      const timer = setTimeout(() => {
        pending.current = null;
        open(id);
      }, holdMs);
      pending.current = { timer, id };
    },
    [open, cancel],
  );
  return { request, cancel };
}
