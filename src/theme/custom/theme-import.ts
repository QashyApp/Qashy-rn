/**
 * Pure helpers behind "Import theme" / "Export theme": turn the text of a picked file into either
 * a validated theme or a short list of path-addressed errors. No I/O, no state, never throws, and
 * never echoes the file's contents (only validator messages, which name paths, not values).
 */

import { exportCustomThemeJson, MAX_CUSTOM_THEME_BYTES, parseCustomTheme, type CustomThemeFile } from '@/theme/custom/schema';

export const MAX_IMPORT_ERRORS_SHOWN = 5;
/** Pre-read cap on the picked file: UTF-8 can take up to 4 bytes per character the schema allows. */
export const MAX_THEME_FILE_BYTES = MAX_CUSTOM_THEME_BYTES * 4;

export type ThemeImportEvaluation =
  | { ok: true; file: CustomThemeFile; warnings: string[]; replaces: boolean }
  | { ok: false; errors: string[] };

export function evaluateThemeImport(text: string, existing: readonly { id: string }[]): ThemeImportEvaluation {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, errors: ['$: the file is not valid JSON'] };
  }
  const result = parseCustomTheme(raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, file: result.file, warnings: result.warnings, replaces: existing.some((entry) => entry.id === result.file.id) };
}

/** The first few errors, with a count of the rest, as one multi-line message. */
export function summarizeImportErrors(errors: readonly string[]): string {
  const shown = errors.slice(0, MAX_IMPORT_ERRORS_SHOWN);
  const rest = errors.length - shown.length;
  return rest > 0 ? [...shown, `…and ${rest} more`].join('\n') : shown.join('\n');
}

export function themeExportFilename(file: Pick<CustomThemeFile, 'id'>): string {
  return `qashy-theme-${file.id}.json`;
}

export { exportCustomThemeJson };
