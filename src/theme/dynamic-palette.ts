import { clampPaletteContrast } from "@/theme/custom/contrast";
import type { ThemeScheme } from "@/theme/themes/types";
import { mixHex, type BaseTokens } from "@/theme/tokens";

/**
 * Derives a full theme palette from the Android 12+ system tonal palettes (the wallpaper colors).
 *
 * The native module (`modules/qashy-dynamic-colors`) hands over `system_accent1/2/3_*` and
 * `system_neutral1/2_*` as hex strings; everything else is computed here, in plain JS, exactly
 * like a seed theme, so the result is real hex (usable for gradients, chart tints and contrast
 * math) rather than opaque platform colors. Pure: no clock, randomness or I/O.
 *
 * Tone keys follow the Android resource naming: "0" (white) .. "1000" (black).
 */
export type TonalPalette = Readonly<Record<string, string>>;
export interface SystemPalettes {
  accent1: TonalPalette;
  accent2: TonalPalette;
  accent3: TonalPalette;
  neutral1: TonalPalette;
  neutral2: TonalPalette;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const TONES = [
  "0",
  "10",
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "1000",
] as const;
const PALETTE_NAMES = [
  "accent1",
  "accent2",
  "accent3",
  "neutral1",
  "neutral2",
] as const;

/** True only for a complete palette set of well-formed `#RRGGBB` strings; anything else is ignored. */
export function isSystemPalettes(value: unknown): value is SystemPalettes {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return PALETTE_NAMES.every((name) => {
    const tones = record[name];
    if (typeof tones !== "object" || tones === null) return false;
    const toneRecord = tones as Record<string, unknown>;
    return TONES.every((tone) => {
      const hex = toneRecord[tone];
      return typeof hex === "string" && HEX.test(hex);
    });
  });
}

export interface DynamicPalette {
  /** Surfaces and text for `scheme`, with the base theme's semantic colors (income/expense/...) kept. */
  palette: BaseTokens;
  /** The primary accent. */
  seed: string;
  accentContainer: string;
  onAccentContainer: string;
  /** Neutral-variant tone 50 (60 in dark): the edge of an outlined control. */
  outline: string;
}

export function deriveDynamicPalette(
  palettes: SystemPalettes,
  scheme: ThemeScheme,
  base: BaseTokens,
): DynamicPalette {
  const {
    accent1: a1,
    accent2: a2,
    accent3: a3,
    neutral1: n1,
    neutral2: n2,
  } = palettes;
  const dark = scheme === "dark";

  const raw: BaseTokens = dark
    ? {
        ...base,
        background: mixHex(n1["900"], n1["1000"], 0.45),
        surface: n1["900"],
        surfaceElevated: mixHex(n1["900"], n1["800"], 0.4),
        surfaceMuted: mixHex(n1["900"], n1["800"], 0.75),
        surfaceSunken: mixHex(n1["900"], n1["1000"], 0.7),
        text: n1["100"],
        textMuted: n2["200"],
        border: n2["700"],
        secondaryContainer: a2["700"],
        onSecondaryContainer: a2["100"],
        tertiaryContainer: a3["700"],
        onTertiaryContainer: a3["100"],
        headerBackground: mixHex(n1["900"], n1["1000"], 0.45),
        navBackground: mixHex(n1["900"], n1["800"], 0.4),
      }
    : {
        ...base,
        background: n1["10"],
        surface: mixHex(n1["10"], n1["50"], 0.5),
        surfaceElevated: n1["50"],
        surfaceMuted: mixHex(n1["50"], n1["100"], 0.6),
        surfaceSunken: n1["100"],
        text: n1["900"],
        textMuted: n2["700"],
        border: n2["200"],
        secondaryContainer: a2["100"],
        onSecondaryContainer: a2["900"],
        tertiaryContainer: a3["100"],
        onTertiaryContainer: a3["900"],
        headerBackground: n1["10"],
        navBackground: n1["50"],
      };

  const { palette } = clampPaletteContrast(scheme, raw);
  return {
    palette,
    seed: dark ? a1["200"] : a1["600"],
    accentContainer: dark ? a1["700"] : a1["100"],
    onAccentContainer: dark ? a1["100"] : a1["900"],
    outline: dark ? n2["400"] : n2["500"],
  };
}

/** How much of the seed each surface takes, per scheme: a gentle wash that grows with elevation. */
const SEED_TINT: Record<
  ThemeScheme,
  Partial<Record<keyof BaseTokens, number>>
> = {
  light: {
    background: 0.05,
    surface: 0.07,
    surfaceElevated: 0.09,
    surfaceMuted: 0.12,
    surfaceSunken: 0.15,
    border: 0.14,
    textMuted: 0.1,
    text: 0.04,
    headerBackground: 0.05,
    navBackground: 0.09,
  },
  dark: {
    background: 0.07,
    surface: 0.09,
    surfaceElevated: 0.12,
    surfaceMuted: 0.16,
    surfaceSunken: 0.05,
    border: 0.14,
    textMuted: 0.08,
    text: 0.04,
    headerBackground: 0.07,
    navBackground: 0.12,
  },
};

/**
 * Washes a theme's neutral surfaces, text and borders with a user-picked seed color, so a chosen
 * accent also colors the background the way the wallpaper palette does. The semantic colors
 * (income, expense, warning, transfer) and the secondary/tertiary containers are left alone, and the
 * result is contrast-clamped like every other derived palette. Pure.
 */
export function tintPaletteWithSeed(
  seed: string,
  scheme: ThemeScheme,
  base: BaseTokens,
): BaseTokens {
  const raw: BaseTokens = { ...base };
  for (const [key, weight] of Object.entries(SEED_TINT[scheme])) {
    const token = key as keyof BaseTokens;
    raw[token] = mixHex(base[token], seed, weight);
  }
  return clampPaletteContrast(scheme, raw).palette;
}
