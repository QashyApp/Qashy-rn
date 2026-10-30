/**
 * Writes a file out by whichever mechanism the platform has: a `Blob` anchor download on web, a
 * cache-directory file handed to the share sheet on native. Contents are never logged.
 *
 * The native copy is left in the cache directory afterwards, so callers should only pass data
 * that is acceptable to leave there (exports the user asked for, or ciphertext).
 *
 * Resolving does not mean the file went anywhere: the share sheet reports the same result whether
 * the user picked a target or dismissed it, and a browser download has no outcome at all. Callers
 * must not treat it as a success to celebrate (no success haptic, no "saved" claim).
 *
 * What it does report is whether the file was handed to anything at all. `"unavailable"` means
 * the platform has no share sheet, so the file was written to the cache and went nowhere; a
 * caller that goes on to say "ready" or "exported" would be lying, so use `requireHandedOff`.
 */

import { File as ExpoFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export type SaveFileResult =
  /** Handed to the native share sheet (which does not say whether a target was picked). */
  | "shared"
  /** Handed to the browser as a download. */
  | "downloaded"
  /** Nothing was handed off: the platform cannot share files. */
  | "unavailable";

const SAVE_UNAVAILABLE_MESSAGE =
  "Sharing isn’t available on this device, so the file couldn’t be saved.";

/** Throws unless the file was handed off, so a caller's own error path reports it. */
export function requireHandedOff(result: SaveFileResult): void {
  if (result === "unavailable") throw new Error(SAVE_UNAVAILABLE_MESSAGE);
}

export async function saveFile(
  name: string,
  mime: string,
  data: string | Uint8Array,
  dialogTitle: string,
): Promise<SaveFileResult> {
  if (process.env.EXPO_OS === "web") {
    // `Blob` rejects a view that might be backed by a SharedArrayBuffer, which is what a bare
    // `Uint8Array` widens to. Copying into a fresh view is the type-safe way to say it is not —
    // one extra copy of a file that is about to be written to disk anyway.
    const part: BlobPart =
      typeof data === "string" ? data : new Uint8Array(data);
    const url = URL.createObjectURL(new Blob([part], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
    return "downloaded";
  }
  const file = new ExpoFile(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(data);
  if (!(await Sharing.isAvailableAsync())) return "unavailable";
  await Sharing.shareAsync(file.uri, {
    // The share intent wants a bare type; the charset parameter only matters for a Blob.
    mimeType: mime.split(";")[0],
    dialogTitle,
  });
  return "shared";
}
