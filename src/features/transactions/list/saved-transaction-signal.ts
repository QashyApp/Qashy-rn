/**
 * "This transaction was just saved — show me where it landed."
 *
 * An in-memory, one-shot hand-off from the transaction sheet to the ledger. It is deliberately not
 * a route parameter: the project keeps finance records out of URLs, and a row id is a record
 * reference. It holds only an id, a count and a month — nothing is persisted, and it expires on
 * its own so a save that never reached the list (a filter hid it) cannot flash a row later.
 */
export interface SavedTransactionSignal {
  readonly id: string;
  /** `YYYY-MM` of the saved transaction's date, so only the matching month page reacts. */
  readonly month: string;
  /** How many times the row flashes. Fewer for an entry dated "now", which is not hard to find. */
  readonly flashes: number;
  /** Distinguishes two saves of the same row. */
  readonly token: number;
  readonly expiresAt: number;
}

/** Long enough for a sheet to close and the month page to mount; short enough to never feel stale. */
export const SIGNAL_LIFETIME_MS = 6000;

const FLASHES_BACK_DATED = 3;
const FLASHES_TODAY = 2;

let current: SavedTransactionSignal | null = null;
let nextToken = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/**
 * Flash count for a save, or 0 for "do not draw attention".
 *
 * An edit that kept its date changed nothing about *where* the row is, so it stays quiet. A new
 * entry, or an edit that moved the date, flashes — fewer times when it is dated today.
 */
export function flashesForSave(input: {
  isNew: boolean;
  previousDate?: string;
  localDate: string;
  today: string;
}) {
  if (!input.isNew && input.previousDate === input.localDate) return 0;
  return input.localDate === input.today ? FLASHES_TODAY : FLASHES_BACK_DATED;
}

export function announceSavedTransaction(
  input: {
    id: string;
    localDate: string;
    isNew: boolean;
    previousDate?: string;
    today: string;
  },
  now = Date.now(),
) {
  const flashes = flashesForSave(input);
  if (flashes === 0) return;
  current = {
    id: input.id,
    month: input.localDate.slice(0, 7),
    flashes,
    token: nextToken++,
    expiresAt: now + SIGNAL_LIFETIME_MS,
  };
  emit();
}

/** The pending signal, or null once it has expired. Stable between calls so it suits `useSyncExternalStore`. */
export function getSavedTransactionSignal(
  now = Date.now(),
): SavedTransactionSignal | null {
  if (current && current.expiresAt <= now) current = null;
  return current;
}

/** Marks the signal handled. A newer save is left alone. */
export function consumeSavedTransactionSignal(token: number) {
  if (current?.token !== token) return;
  current = null;
  emit();
}

export function subscribeSavedTransactionSignal(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests. */
export function resetSavedTransactionSignal() {
  current = null;
  nextToken = 1;
  listeners.clear();
}
