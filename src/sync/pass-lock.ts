/**
 * Serializes whole sync passes inside one JS runtime.
 *
 * The foreground (`SyncProvider`) and the opt-in background task (`background.ts`) each own their
 * own `SyncRuntime`, and each runtime only coalesces passes on itself. When Android starts the
 * background task inside an app process that is alive, both are in the same JS context, so two
 * passes could allocate from the same op chain at once. Every pass therefore runs through this
 * queue: one at a time, in arrival order, and a failing pass never blocks the next.
 *
 * It is a promise chain, not a timer, so it adds no traffic pattern.
 */

let tail: Promise<unknown> = Promise.resolve();

export function withSyncPassLock<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
