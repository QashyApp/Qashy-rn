/**
 * File access for custom themes: pick a `.json` to read, save/share one to export, through the
 * shared `pick-file` and `save-file` helpers. The size check stays here rather than in
 * `readAssetText` because its errors are the theme's own localized strings. Contents are never
 * logged.
 */

import { File as ExpoFile } from "expo-file-system";

import { fileExtension, pickAsset } from "@/features/shared/pick-file";
import { requireHandedOff, saveFile } from "@/features/shared/save-file";
import { MAX_THEME_FILE_BYTES } from "@/theme/custom/theme-import";

/**
 * Returns the picked file's text, or `null` when the picker was cancelled. Throws on an
 * unreadable, oversized, or wrongly named file.
 *
 * The MIME filter is not used: Android reports a `.json` as `application/octet-stream` or other
 * types, so an unfiltered pick with the extension checked afterwards is what actually works.
 */
export async function pickThemeFileText(): Promise<string | null> {
  const asset = await pickAsset();
  if (!asset) return null;
  if (fileExtension(asset.name) !== "json") {
    throw new Error("Choose a .json theme file.");
  }
  const nativeFile = asset.file ? null : new ExpoFile(asset.uri);
  const size = asset.size ?? asset.file?.size ?? nativeFile?.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new Error(
      "The theme file size could not be checked safely. Choose another file.",
    );
  }
  if (size > MAX_THEME_FILE_BYTES)
    throw new Error("This file is too large to be a theme.");
  return asset.file ? asset.file.text() : nativeFile!.text();
}

/** Downloads (web) or shares (native) a theme JSON file. */
export async function saveThemeFile(
  filename: string,
  json: string,
  dialogTitle: string,
): Promise<void> {
  requireHandedOff(
    await saveFile(
      filename,
      "application/json;charset=utf-8",
      json,
      dialogTitle,
    ),
  );
}
