import {
  contrastRatio,
  ensureContrast,
  readableTextColor,
  type BaseTokens,
} from "@/theme/tokens";
import type { ThemeScheme } from "@/theme/themes/types";

/**
 * Contrast enforcement for user-authored palettes.
 *
 * A custom theme is CLAMPED, not rejected, when its colors are too faint: the offending color is
 * moved toward readable text by `ensureContrast` and a human-readable warning names what changed.
 *
 * The accent is not handled here: `accentTokens` (src/theme/theme.tsx) already clamps the
 * resolved accent against the scheme's surface to 3:1 at render time via `accessibleAccentColor`,
 * whatever the theme or the user picked, and derives `onAccent` from it with `readableTextColor`.
 * (`schema.test.ts` verifies this for a custom theme.)
 *
 * Pure: no clock, no randomness, no I/O.
 */

export const TEXT_MIN_CONTRAST = 4.5;
export const STATUS_MIN_CONTRAST = 3;

type Key = keyof BaseTokens;

/**
 * Every surface a text-bearing color can sit on: the page and cards, plus the sunken form wells and
 * muted choice-list wells that carry text too.
 */
export const TEXT_SURFACES: readonly Key[] = [
  "surface",
  "surfaceElevated",
  "background",
  "surfaceSunken",
  "surfaceMuted",
];

export interface ContrastResult {
  palette: BaseTokens;
  /** One line per changed color, e.g. `palette.light.textMuted raised from #aaaaaa to #767676 to keep 4.5:1 against surface`. */
  warnings: string[];
  /** Requirements no single color can satisfy (e.g. one text color that must read on both a light and a dark surface). */
  unsatisfied: string[];
}

function sameColor(first: string, second: string) {
  return first.toUpperCase() === second.toUpperCase();
}

export function clampPaletteContrast(
  scheme: ThemeScheme,
  input: BaseTokens,
): ContrastResult {
  const palette: BaseTokens = { ...input };
  const warnings: string[] = [];
  const unsatisfied: string[] = [];
  const original: Partial<Record<Key, string>> = {};
  const against: Partial<Record<Key, { min: number; on: Key }>> = {};

  const clamp = (key: Key, on: Key, fallback: string, min: number) => {
    const before = palette[key];
    const after = ensureContrast(before, palette[on], fallback, min);
    if (!sameColor(before, after)) {
      original[key] ??= input[key];
      against[key] = { min, on };
      palette[key] = after;
    }
  };

  // Every surface that can carry text (form inputs and choice-list wells included). Moving text
  // toward the readable extreme of one surface can in principle break another, so iterate until
  // stable (a few passes at most).
  const surfaces: readonly Key[] = TEXT_SURFACES;
  for (let pass = 0; pass < 3; pass += 1) {
    const snapshot = palette.text;
    for (const surface of surfaces)
      clamp(
        "text",
        surface,
        readableTextColor(palette[surface]),
        TEXT_MIN_CONTRAST,
      );
    if (sameColor(snapshot, palette.text)) break;
  }

  for (const surface of surfaces)
    clamp("textMuted", surface, palette.text, TEXT_MIN_CONTRAST);
  for (const key of ["positive", "negative", "warning"] as const) {
    for (const surface of surfaces)
      clamp(key, surface, palette.text, STATUS_MIN_CONTRAST);
  }
  // Content colors of the tonal containers read on their own container, not on the page.
  clamp(
    "onSecondaryContainer",
    "secondaryContainer",
    palette.text,
    TEXT_MIN_CONTRAST,
  );
  clamp(
    "onTertiaryContainer",
    "tertiaryContainer",
    palette.text,
    TEXT_MIN_CONTRAST,
  );

  for (const key of Object.keys(original) as Key[]) {
    const spec = against[key];
    if (!spec) continue;
    warnings.push(
      `palette.${scheme}.${key} changed from ${original[key]} to ${palette[key]} to keep ${spec.min}:1 contrast against ${spec.on}`,
    );
  }

  const check = (key: Key, on: Key, min: number) => {
    if (contrastRatio(palette[key], palette[on]) < min) {
      unsatisfied.push(
        `palette.${scheme}.${key}: cannot reach ${min}:1 against palette.${scheme}.${on}`,
      );
    }
  };
  for (const surface of surfaces) {
    check("text", surface, TEXT_MIN_CONTRAST);
    check("textMuted", surface, TEXT_MIN_CONTRAST);
    for (const key of ["positive", "negative", "warning"] as const)
      check(key, surface, STATUS_MIN_CONTRAST);
  }
  check("onSecondaryContainer", "secondaryContainer", TEXT_MIN_CONTRAST);
  check("onTertiaryContainer", "tertiaryContainer", TEXT_MIN_CONTRAST);

  return { palette, warnings, unsatisfied };
}
