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
 */

import { File as ExpoFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function saveFile(
  name: string,
  mime: string,
  data: string | Uint8Array,
  dialogTitle: string,
): Promise<void> {
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
    return;
  }
  const file = new ExpoFile(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(data);
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, {
      // The share intent wants a bare type; the charset parameter only matters for a Blob.
      mimeType: mime.split(";")[0],
      dialogTitle,
    });
}
