import type { TypeSpec } from "@/theme/themes/types";

export type FontScript = "latin" | "hebrew";
export type FontWeightKey = "regular" | "medium" | "semibold" | "bold";

export interface FontWeightFile {
  /** The family name the file is registered under once loaded (e.g. `Rubik_400Regular`). */
  family: string;
  /** A `require()`d local font file. Nothing here touches the network. */
  asset: number;
}

export interface FontDefinition {
  id: string;
  label: string;
  weights: Record<FontWeightKey, FontWeightFile>;
  scripts: FontScript[];
}

const RUBIK_400 = require("@expo-google-fonts/rubik/400Regular/Rubik_400Regular.ttf");
const RUBIK_500 = require("@expo-google-fonts/rubik/500Medium/Rubik_500Medium.ttf");
const RUBIK_600 = require("@expo-google-fonts/rubik/600SemiBold/Rubik_600SemiBold.ttf");
const RUBIK_700 = require("@expo-google-fonts/rubik/700Bold/Rubik_700Bold.ttf");
const GROTESK_500 = require("@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf");
const GROTESK_600 = require("@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf");
const GROTESK_700 = require("@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf");
const PIXELIFY_400 = require("@expo-google-fonts/pixelify-sans/400Regular/PixelifySans_400Regular.ttf");
const PIXELIFY_500 = require("@expo-google-fonts/pixelify-sans/500Medium/PixelifySans_500Medium.ttf");
const PIXELIFY_600 = require("@expo-google-fonts/pixelify-sans/600SemiBold/PixelifySans_600SemiBold.ttf");
const PIXELIFY_700 = require("@expo-google-fonts/pixelify-sans/700Bold/PixelifySans_700Bold.ttf");

/**
 * Every bundled font face. A theme names faces by id (`ThemeDefinition.type`); the registry owns
 * the files, so a theme can never reference a font that is not shipped (and precached).
 */
export const FONT_REGISTRY: Record<string, FontDefinition> = {
  rubik: {
    id: "rubik",
    label: "Rubik",
    weights: {
      regular: { family: "Rubik_400Regular", asset: RUBIK_400 },
      medium: { family: "Rubik_500Medium", asset: RUBIK_500 },
      semibold: { family: "Rubik_600SemiBold", asset: RUBIK_600 },
      bold: { family: "Rubik_700Bold", asset: RUBIK_700 },
    },
    scripts: ["latin", "hebrew"],
  },
  "space-grotesk": {
    id: "space-grotesk",
    label: "Space Grotesk",
    // There is no 400 file: regular resolves to the lightest weight actually bundled.
    weights: {
      regular: { family: "SpaceGrotesk_500Medium", asset: GROTESK_500 },
      medium: { family: "SpaceGrotesk_500Medium", asset: GROTESK_500 },
      semibold: { family: "SpaceGrotesk_600SemiBold", asset: GROTESK_600 },
      bold: { family: "SpaceGrotesk_700Bold", asset: GROTESK_700 },
    },
    scripts: ["latin"],
  },
  "pixelify-sans": {
    id: "pixelify-sans",
    label: "Pixelify Sans",
    weights: {
      regular: { family: "PixelifySans_400Regular", asset: PIXELIFY_400 },
      medium: { family: "PixelifySans_500Medium", asset: PIXELIFY_500 },
      semibold: { family: "PixelifySans_600SemiBold", asset: PIXELIFY_600 },
      bold: { family: "PixelifySans_700Bold", asset: PIXELIFY_700 },
    },
    scripts: ["latin"],
  },
};

/** Loadable `{ family: asset }` map for the given registry ids (what `useFonts` takes). */
export function fontAssetsFor(ids: readonly string[]): Record<string, number> {
  const assets: Record<string, number> = {};
  for (const id of ids) {
    const font = FONT_REGISTRY[id];
    if (!font) continue;
    for (const file of Object.values(font.weights))
      assets[file.family] = file.asset;
  }
  return assets;
}

const REGISTERED_FAMILIES = new Set(
  Object.values(FONT_REGISTRY).flatMap((font) =>
    Object.values(font.weights).map((file) => file.family),
  ),
);

/** True for any loaded family name that belongs to a registered font. */
export function isRegisteredFamily(name: string): boolean {
  return REGISTERED_FAMILIES.has(name);
}

/** The registry ids a theme's type spec needs loaded, de-duplicated, in stack order. */
export function fontIdsForTheme(type: TypeSpec): string[] {
  const ids = [
    type.text.family,
    ...type.text.fallbacks,
    type.numeric.family,
    ...type.numeric.fallbacks,
  ];
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** Scripts the text stack renders: the union over the text family and its fallbacks. */
export function scriptsCovered(type: TypeSpec): Set<FontScript> {
  const covered = new Set<FontScript>();
  for (const id of [type.text.family, ...type.text.fallbacks]) {
    for (const script of FONT_REGISTRY[id]?.scripts ?? []) covered.add(script);
  }
  return covered;
}
