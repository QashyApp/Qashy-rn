/**
 * File access for custom themes: pick a `.json` to read, save/share one to export. Mirrors the
 * mechanism `csv-screen.tsx` uses (DocumentPicker + expo-file-system on native, a `Blob` anchor on
 * web), so no new dependency. Contents are never logged.
 */

import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { MAX_THEME_FILE_BYTES } from '@/theme/custom/theme-import';

/** Returns the picked file's text, or `null` when the picker was cancelled. Throws on an unreadable or oversized file. */
export async function pickThemeFileText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    base64: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const nativeFile = asset.file ? null : new ExpoFile(asset.uri);
  const size = asset.size ?? asset.file?.size ?? nativeFile?.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('The theme file size could not be checked safely. Choose another file.');
  }
  if (size > MAX_THEME_FILE_BYTES) throw new Error('This file is too large to be a theme.');
  return asset.file ? asset.file.text() : nativeFile!.text();
}

/** Downloads (web) or shares (native) a theme JSON file. */
export async function saveThemeFile(filename: string, json: string, dialogTitle: string): Promise<void> {
  if (process.env.EXPO_OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
    return;
  }
  const file = new ExpoFile(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle });
}
