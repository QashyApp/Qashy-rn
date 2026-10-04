import { StyleSheet, type StyleProp, type TextStyle } from "react-native";

import {
  FONT_REGISTRY,
  fontAssetsFor,
  isRegisteredFamily,
  type FontWeightKey,
} from "@/theme/fonts";
import { classicTheme } from "@/theme/themes/classic";
import type { FontStackSpec, TypeSpec } from "@/theme/themes/types";
import type { FontWeightName } from "@/theme/tokens";

/**
 * Local font files, keyed by loaded family name, derived from the font registry.
 * Loaded once by the root layout; nothing here touches the network, and on web
 * the files ship in `dist/` where the service worker precaches them with the
 * rest of the shell.
 */
export const FONT_ASSETS = fontAssetsFor(Object.keys(FONT_REGISTRY));

// A system stack behind the bundled face on web, so text is readable during
// the brief swap on a cold, uncached first load instead of falling back to
// the browser's serif default.
const WEB_FALLBACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Hebrew", sans-serif';

export function weightName(weight: TextStyle["fontWeight"]): FontWeightName {
  const numeric =
    weight === "bold"
      ? 700
      : weight === "normal" || weight == null
        ? 400
        : Number(weight);
  if (!Number.isFinite(numeric) || numeric < 450) return "regular";
  if (numeric < 550) return "medium";
  if (numeric < 650) return "semibold";
  return "bold";
}

const CSS_WEIGHT = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;
const WEIGHT_ORDER: readonly FontWeightKey[] = [
  "regular",
  "medium",
  "semibold",
  "bold",
];

// A stack's faces never change, but every `AppText` render asks for one. Resolved styles are
// cached per stack object and weight; callers only spread them, never mutate.
const STACK_CACHE = new WeakMap<
  FontStackSpec,
  Partial<Record<FontWeightName, TextStyle>>
>();

function resolveStack(stack: FontStackSpec, weight: FontWeightName): TextStyle {
  let byWeight = STACK_CACHE.get(stack);
  if (!byWeight) {
    byWeight = {};
    STACK_CACHE.set(stack, byWeight);
  }
  return (byWeight[weight] ??= resolveStackUncached(stack, weight));
}

function resolveStackUncached(
  stack: FontStackSpec,
  weight: FontWeightName,
): TextStyle {
  const font = FONT_REGISTRY[stack.family];
  if (!font) throw new Error(`Unknown font "${stack.family}".`);
  const family = font.weights[weight].family;
  if (process.env.EXPO_OS === "web") {
    // Per-glyph fallback: a Latin-only face lists a face that covers Hebrew behind it.
    const names = [family];
    for (const id of stack.fallbacks) {
      const fallback = FONT_REGISTRY[id]?.weights[weight].family;
      if (fallback && !names.includes(fallback)) names.push(fallback);
    }
    // The CSS weight follows the file actually used: a face with no 400 file maps regular to its
    // medium file, so the last weight sharing that file wins.
    const cssKey =
      [...WEIGHT_ORDER]
        .reverse()
        .find((key) => font.weights[key].family === family) ?? weight;
    return {
      fontFamily: `${names.join(", ")}, ${WEB_FALLBACK}`,
      fontWeight: CSS_WEIGHT[cssKey],
    };
  }
  return { fontFamily: family, fontWeight: undefined };
}

/**
 * The font properties for one weight of the theme's text face.
 *
 * Native gets the weight's own family and *no* `fontWeight`: with a static
 * font file, a `fontWeight` on Android synthesises a fake bold on top of the
 * real one, and iOS may ignore the family entirely. Web keeps the numeric
 * weight so the system fallback renders at the intended weight too.
 */
export function fontStyle(
  weight: FontWeightName,
  type: TypeSpec = classicTheme.type,
): TextStyle {
  return resolveStack(type.text, weight);
}

/**
 * The font properties for one weight of the theme's numeric face. A face with
 * no file for a weight resolves to the nearest bundled one (the registry maps
 * it; Space Grotesk regular is its medium file). Only digits and the handful
 * of symbols money formatting uses are rendered in this face, so it may be
 * Latin-only.
 */
export function numericFontStyle(
  weight: FontWeightName,
  type: TypeSpec = classicTheme.type,
): TextStyle {
  return resolveStack(type.numeric, weight);
}

/**
 * Resolves a composed text style so its `fontWeight` picks the matching
 * family for the requested face. Call sites keep writing `fontWeight: '700'`
 * in overrides and still get the real bold file rather than a synthesised
 * one. `face: 'numeric'` resolves the numeric stack instead of the text stack.
 * A style carrying a foreign `fontFamily` is returned untouched.
 */
export function withAppFont(
  style: StyleProp<TextStyle>,
  fallback: FontWeightName = "regular",
  face: "text" | "numeric" = "text",
  type: TypeSpec = classicTheme.type,
): TextStyle {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily && !isRegisteredFamily(flat.fontFamily)) return flat;
  const weight =
    flat.fontWeight != null ? weightName(flat.fontWeight) : fallback;
  return {
    ...flat,
    ...(face === "numeric"
      ? numericFontStyle(weight, type)
      : fontStyle(weight, type)),
  };
}
