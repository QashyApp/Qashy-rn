/**
 * What the backup card may claim, and when the passphrase may go.
 *
 * `saveFile` cannot know whether the file went anywhere: the share sheet resolves the same way
 * when a target was picked and when it was dismissed, and a browser download has no outcome at
 * all. So handing the file off is never reported as "saved". The card says the backup is ready,
 * keeps the passphrase the user just typed (they may need to export again if the sheet was
 * dismissed), and only clears it when the person says they have the file.
 */

export type BackupPhase = "idle" | "ready" | "confirmed";

export type BackupEvent = "handedOff" | "confirm" | "edit" | "switchLock";

export function nextBackupPhase(
  phase: BackupPhase,
  event: BackupEvent,
): BackupPhase {
  switch (event) {
    case "handedOff":
      return "ready";
    case "confirm":
      // Only meaningful once there is something to confirm.
      return phase === "ready" ? "confirmed" : phase;
    case "edit":
    case "switchLock":
      return "idle";
  }
}

/**
 * The passphrase is wiped by the user's own confirmation, or by switching the lock while the
 * confirm card is showing (the card goes, and it must not outlive it). Never by the hand-off, and
 * never when no backup was made with it: a passphrase typed but not yet used is not lost.
 */
export const clearsPassphrase = (event: BackupEvent, phase: BackupPhase) =>
  (event === "confirm" || event === "switchLock") && phase === "ready";
