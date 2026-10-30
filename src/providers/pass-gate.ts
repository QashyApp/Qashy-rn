/**
 * Admission control for the provider's sync passes: one at a time, no timers.
 *
 * A pass that is already running makes an ordinary request a no-op, because foreground events
 * arrive in bursts (`visibilitychange`, `focus` and `pageshow` together) and each extra pass is
 * another relay contact. A caller that genuinely needs a pass to have run *after* now (a device
 * that has just joined a vault and is waiting for its data) asks to be queued instead: it waits
 * for the running pass with a promise, then at most one follow-up pass runs, shared by every
 * queued caller. Nothing polls and nothing is scheduled.
 */

export interface PassGate {
  /**
   * Runs a pass unless one is running. Resolves `false`, without running, when one is — which is
   * "skipped", not "failed".
   */
  readonly request: () => Promise<boolean>;
  /**
   * Runs a pass, waiting for the running one first. Resolves with the result of a pass that
   * started after this call, so it is never settled by a pass that began earlier.
   */
  readonly requestQueued: () => Promise<boolean>;
}

export function createPassGate(run: () => Promise<boolean>): PassGate {
  let current: Promise<boolean> | null = null;
  let followUp: Promise<boolean> | null = null;

  const start = (): Promise<boolean> => {
    const pass = run().finally(() => {
      current = null;
    });
    current = pass;
    return pass;
  };

  return {
    request: () => (current ? Promise.resolve(false) : start()),
    requestQueued: () => {
      if (!current) return start();
      followUp ??= (async () => {
        // Looped: a foreground event may start a pass in the gap after the one waited on.
        while (current) await current.catch(() => undefined);
        // Released the moment the follow-up starts, not when it ends: a caller arriving during it
        // needs a pass that begins after that call, which this one no longer is.
        followUp = null;
        return start();
      })();
      return followUp;
    },
  };
}
