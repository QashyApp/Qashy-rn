/** Constants and helpers the widget kinds and the snapshot share. */

export const MAX_WIDGET_ROWS = 30;
/** Shown in place of every amount when "hide amounts" is on. */
export const MASKED_AMOUNT = "•••";

/** `value` when it is one of `allowed`, else `fallback`. */
export function oneOf<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
