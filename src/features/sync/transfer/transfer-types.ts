import { type BackupKeySource } from "@/sync/backup";

/** Which long-running action owns the screen, so two can never be started at once. */
export type Busy = "backup" | "open" | "restore" | "send" | "receive" | null;

/** A chosen file, held between picking it and knowing the secret that opens it. */
export interface PickedBackup {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly wants: BackupKeySource["kind"];
}
