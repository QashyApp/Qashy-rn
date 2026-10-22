import { useCallback, useEffect, useRef, useState } from "react";

/** How long an optimistic value is shown while the `value` prop has not caught up. */
export const OPTIMISTIC_SWITCH_TIMEOUT_MS = 1500;

/**
 * Lets a controlled switch show a toggle immediately although its `value` prop only changes once
 * the change has been persisted. The tapped value is shown until the prop changes (then the prop
 * wins again) or, if the save never lands, until the timeout passes and the prop value shows again.
 */
export function useOptimisticSwitch(
  value: boolean,
  onValueChange: ((next: boolean) => void | Promise<void>) | null | undefined,
  timeoutMs: number = OPTIMISTIC_SWITCH_TIMEOUT_MS,
) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [seen, setSeen] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Any change of the prop (the save landing, or another source) hands control back to it. Adjusted
  // while rendering, so the stale optimistic value is never painted next to the new prop.
  if (seen !== value) {
    setSeen(value);
    setPending(null);
  }

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onChange = useCallback(
    (next: boolean) => {
      setPending(next);
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        setPending(null);
      }, timeoutMs);
      return onValueChange?.(next);
    },
    [onValueChange, timeoutMs, clear],
  );

  return {
    value: seen !== value ? value : (pending ?? value),
    onValueChange: onChange,
  };
}
