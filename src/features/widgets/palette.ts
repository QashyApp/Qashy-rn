/**
 * Resolves the colors a home-screen widget is drawn with.
 *
 * The widget follows the user's current app theme (theme id, accent, custom themes, and the
 * wallpaper accent when the accent source is "system"), resolved with the same token builders the
 * app's theme provider uses, so a widget and the app can't drift apart. Everything leaves here as
 * `#RRGGBB`: the native side takes no alpha, no named colors, no opaque platform colors.
 *
 * Material You, as a widget option, is resolved natively from the system colors; these Qashy
 * palettes are still sent as its fallback.
 *
 * Pure apart from reading the theme registry: the custom themes and wallpaper palettes are
 * passed in.
 */

import type { AppSettings } from "@/domain/models";
import type { WidgetAppearance } from "@/features/widgets/settings";
import type { SystemPalettes } from "@/theme/dynamic-palette";
import {
  accentTokens,
  paletteTokens,
  resolveAccentChoice,
  type ThemeTokens,
} from "@/theme/theme";
import { getTheme } from "@/theme/themes/registry";
import type { ThemeDefinition } from "@/theme/themes/types";
import { ensureContrast, mixHex, readableTextColor } from "@/theme/tokens";

export interface Palette {
  /** The card surface. With `background: "accent"` the native side paints `accent` instead. */
  background: string;
  text: string;
  textMuted: string;
  accent: string;
  /** Readable on `accent`. */
  onAccent: string;
  positive: string;
  negative: string;
  border: string;
}

export interface WidgetPalettes {
  light: Palette;
  dark: Palette;
}

export type WidgetPaletteSettings = Pick<
  AppSettings,
  "themeId" | "accentSource" | "accentHex"
>;

export interface WidgetPaletteContext {
  /** Parsed user-authored themes (see `custom-themes-store`); a missing one falls back to Classic. */
  customThemes?: readonly ThemeDefinition[];
  /** The Android 12+ wallpaper palettes; `null` when unavailable. */
  systemPalettes?: SystemPalettes | null;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i;
const HEX8 = /^#([0-9a-f]{6})[0-9a-f]{2}$/i;
const RGB =
  /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;

/** Any color form to `#RRGGBB` (alpha dropped); `fallback` for anything unreadable. */
export function toHex6(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (HEX6.test(text)) return text.toUpperCase();
  const eight = HEX8.exec(text);
  if (eight) return `#${eight[1]}`.toUpperCase();
  const three = HEX3.exec(text);
  if (three)
    return `#${three[1]}${three[1]}${three[2]}${three[2]}${three[3]}${three[3]}`.toUpperCase();
  const rgb = RGB.exec(text);
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((part) =>
      Math.min(255, Number(part)),
    );
    return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return fallback;
}

function tokensFor(
  theme: ThemeDefinition,
  settings: WidgetPaletteSettings,
  dark: boolean,
  palettes: SystemPalettes | null,
): ThemeTokens {
  const choice = resolveAccentChoice(theme, settings);
  if (choice.kind === "seed") return accentTokens(choice.seed, dark, theme);
  // The app paints Android's opaque platform colors here when the wallpaper palettes can't be
  // read; a widget needs real hex, so it takes the theme's own default accent instead.
  return palettes
    ? paletteTokens(palettes, dark, theme)
    : accentTokens(theme.accent.default, dark, theme);
}

function fromTokens(tokens: ThemeTokens): Palette {
  const background = toHex6(tokens.staticSurface, "#FFFFFF");
  const text = toHex6(tokens.staticText, readableTextColor(background));
  const accent = toHex6(tokens.staticAccent, "#5070FF");
  return {
    background,
    text,
    textMuted: toHex6(tokens.textMuted, text),
    accent,
    onAccent: ensureContrast(
      toHex6(tokens.onAccent, readableTextColor(accent)),
      accent,
      readableTextColor(accent),
    ),
    positive: toHex6(tokens.positive, text),
    negative: toHex6(tokens.negative, text),
    border: toHex6(tokens.border, text),
  };
}

/** A palette on a user-chosen background: text and status colors are chosen to stay readable on it. */
function onCustomBackground(base: Palette, customColor: string): Palette {
  const background = toHex6(customColor, base.background);
  const text = readableTextColor(background);
  return {
    ...base,
    background,
    text,
    textMuted: ensureContrast(mixHex(text, background, 0.35), background, text),
    positive: ensureContrast(base.positive, background, text),
    negative: ensureContrast(base.negative, background, text),
    border: mixHex(text, background, 0.8),
  };
}

/** The color helpers return lower case; the wire format is one canonical `#RRGGBB` form. */
function upperCase(palette: Palette): Palette {
  const result = { ...palette };
  for (const key of Object.keys(result) as (keyof Palette)[])
    result[key] = result[key].toUpperCase();
  return result;
}

export function resolveWidgetPalettes(
  appearance: Pick<WidgetAppearance, "background" | "customColor">,
  appSettings: WidgetPaletteSettings,
  context: WidgetPaletteContext = {},
): WidgetPalettes {
  const theme = getTheme(appSettings.themeId, context.customThemes ?? []);
  const palettes = context.systemPalettes ?? null;
  const resolve = (dark: boolean): Palette => {
    const base = fromTokens(tokensFor(theme, appSettings, dark, palettes));
    return upperCase(
      appearance.background === "custom" && appearance.customColor
        ? onCustomBackground(base, appearance.customColor)
        : base,
    );
  };
  return { light: resolve(false), dark: resolve(true) };
}
