import {
  clearsPassphrase,
  nextBackupPhase,
} from "@/features/sync/transfer/backup-phase";

describe("backup phase", () => {
  it("never calls a hand-off a save, and keeps the passphrase until the user confirms", () => {
    const afterHandOff = nextBackupPhase("idle", "handedOff");
    expect(afterHandOff).toBe("ready");
    expect(clearsPassphrase("handedOff", "idle")).toBe(false);
    expect(clearsPassphrase("confirm", afterHandOff)).toBe(true);
    expect(nextBackupPhase(afterHandOff, "confirm")).toBe("confirmed");
  });

  it("ignores a confirmation when nothing was handed off", () => {
    expect(nextBackupPhase("idle", "confirm")).toBe("idle");
    expect(clearsPassphrase("confirm", "idle")).toBe(false);
  });

  it("wipes the passphrase on a lock switch only once a backup used it", () => {
    expect(clearsPassphrase("switchLock", "ready")).toBe(true);
    expect(clearsPassphrase("switchLock", "idle")).toBe(false);
    expect(clearsPassphrase("switchLock", "confirmed")).toBe(false);
    expect(nextBackupPhase("ready", "switchLock")).toBe("idle");
  });

  it("goes back to idle when the inputs change, and a second export is ready again", () => {
    expect(nextBackupPhase("confirmed", "edit")).toBe("idle");
    expect(nextBackupPhase("confirmed", "handedOff")).toBe("ready");
  });
});
