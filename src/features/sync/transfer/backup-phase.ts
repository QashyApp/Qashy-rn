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

export type BackupEvent = "handedOff" | "confirm" | "edit";

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
      return "idle";
  }
}

/** The passphrase is wiped only by the user's own confirmation, never by the hand-off. */
export const clearsPassphrase = (event: BackupEvent, phase: BackupPhase) =>
  event === "confirm" && phase === "ready";
