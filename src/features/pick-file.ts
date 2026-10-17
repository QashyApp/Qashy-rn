/**
 * Picking a local file and reading it under a size cap, for the import screens.
 *
 * The picker is unfiltered on purpose: Android reports Qashy's own extensions (and `.csv`) with a
 * blank or generic MIME type, so a MIME filter would hide them. Callers check the extension, or
 * the file's own magic bytes, after picking.
 */

import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";

import { assertFileSize } from "@/utils/file-size";

export type PickedAsset = DocumentPicker.DocumentPickerAsset;

/** Opens the system picker; null when the user cancels. */
export async function pickAsset(): Promise<PickedAsset | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
    base64: false,
  });
  return result.canceled ? null : result.assets[0];
}

/** Lower-case extension without the dot; empty when the name has none. */
export function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Web assets carry a `File`; native ones are read through `expo-file-system`. */
function openAsset(asset: PickedAsset, maxBytes: number, label: string) {
  const nativeFile = asset.file ? null : new ExpoFile(asset.uri);
  assertFileSize(
    asset.size ?? asset.file?.size ?? nativeFile?.size,
    maxBytes,
    label,
  );
  return { webFile: asset.file ?? null, nativeFile };
}

/** The asset's text, after checking its size against `maxBytes`. */
export async function readAssetText(
  asset: PickedAsset,
  maxBytes: number,
  label: string,
): Promise<string> {
  const { webFile, nativeFile } = openAsset(asset, maxBytes, label);
  return webFile ? await webFile.text() : await nativeFile!.text();
}

/** The asset's bytes, after checking its size against `maxBytes`. */
export async function readAssetBytes(
  asset: PickedAsset,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const { webFile, nativeFile } = openAsset(asset, maxBytes, label);
  return webFile
    ? new Uint8Array(await webFile.arrayBuffer())
    : await nativeFile!.bytes();
}
