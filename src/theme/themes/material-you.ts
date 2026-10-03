import { flatShadowSet } from "@/theme/shadow";
import { classicTheme } from "@/theme/themes/classic";
import type {
  RadiusScale,
  ThemeDefinition,
  TypeScaleSpec,
} from "@/theme/themes/types";
import { ACCENT_PRESETS, typeScale, type BaseTokens } from "@/theme/tokens";

// Soft tonal Material 3 surfaces. On Android 12+ the whole palette is re-derived from the
// system tonal palettes by `QashyThemeProvider` (see `src/theme/dynamic-palette.ts`); these
// values are what web and older Android show, so they are the theme's default look.

const lightPalette: BaseTokens = {
  background: "#FEF7FF",
  surface: "#F7F2FA",
  surfaceElevated: "#F3EDF7",
  surfaceMuted: "#ECE6F0",
  surfaceSunken: "#E6E0E9",
  text: "#1D1B20",
  textMuted: "#49454F",
  border: "#CAC4D0",
  positive: "#1B6C3A",
  negative: "#B3261E",
  warning: "#8A5100",
  transfer: "#4A5FB0",
  secondaryContainer: "#E8DEF8",
  onSecondaryContainer: "#1D192B",
  tertiaryContainer: "#FFD8E4",
  onTertiaryContainer: "#31111D",
  headerBackground: "#FEF7FF",
  navBackground: "#F3EDF7",
};

const darkPalette: BaseTokens = {
  background: "#141218",
  surface: "#1D1B20",
  surfaceElevated: "#211F26",
  surfaceMuted: "#2B2930",
  surfaceSunken: "#0F0D13",
  text: "#E6E0E9",
  textMuted: "#CAC4D0",
  border: "#49454F",
  positive: "#81D69B",
  negative: "#F2B8B5",
  warning: "#F0C36A",
  transfer: "#B5C4FF",
  secondaryContainer: "#4A4458",
  onSecondaryContainer: "#E8DEF8",
  tertiaryContainer: "#633B48",
  onTertiaryContainer: "#FFD8E4",
  headerBackground: "#141218",
  navBackground: "#211F26",
};

const radius: RadiusScale = {
  sm: 12,
  control: 16,
  tile: 16,
  card: 24,
  sheet: 28,
  nav: 20,
  // A rounded square, not a pill.
  fab: 18,
  pill: 999,
};

// A friendlier, heavier scale: titles and figures go bold, labels semibold.
const scale: TypeScaleSpec = {
  hero: { ...typeScale.hero, weight: "bold", letterSpacing: -1.2 },
  display: { ...typeScale.display, weight: "bold", letterSpacing: -0.8 },
  title: { ...typeScale.title, weight: "bold", letterSpacing: -0.3 },
  money: { ...typeScale.money, weight: "bold", letterSpacing: -0.2 },
  headline: { ...typeScale.headline, weight: "bold", letterSpacing: -0.1 },
  body: { ...typeScale.body, weight: "regular" },
  label: { ...typeScale.label, weight: "semibold", letterSpacing: 0 },
  figure: { ...typeScale.figure, weight: "bold", letterSpacing: -0.1 },
  caption: { ...typeScale.caption, weight: "medium" },
  overline: { ...typeScale.overline, weight: "semibold" },
  eyebrow: { ...typeScale.eyebrow, weight: "bold" },
};

/**
 * Flat, tonal Material 3 look: no gradients or drop shadows, depth from surface steps, outlined
 * or tonal cards, filled circular category badges over colorful category art, a rounded-square
 * FAB and a bolder type scale in Figtree. Offered on Android and web; iOS has Classic and High
 * Contrast. The accent defaults to the wallpaper's on Android 12+ (the theme's default elsewhere), and can be
 * switched to a curated or custom color on the Appearance screen.
 */
export const materialYouTheme: ThemeDefinition = {
  ...classicTheme,
  id: "material-you",
  name: "Material You",
  palette: { light: lightPalette, dark: darkPalette },
  shadows: {
    light: flatShadowSet(lightPalette, "light"),
    dark: flatShadowSet(darkPalette, "dark"),
  },
  radius,
  motion: { ...classicTheme.motion, press: "overlay" },
  material: { engine: "flat", card: "tonal", gradients: false, bevelDepth: 0 },
  type: {
    text: { family: "figtree", fallbacks: ["rubik"] },
    numeric: { family: "figtree", fallbacks: ["rubik"] },
    scale,
  },
  icons: {
    set: "material",
    categorySet: "fluent-emoji-flat",
    badge: "filled",
    badgeShape: "circle",
  },
  charts: {
    ...classicTheme.charts,
    donutThickness: 18,
    gridDash: "",
    categoryPalette: [
      "#43A047",
      "#FB8C00",
      "#1E88E5",
      "#8E24AA",
      "#E53935",
      "#D81B60",
      "#00ACC1",
      "#6D4C41",
    ],
    tone: { containerMix: { light: 0.8, dark: 0.7 }, minContrast: 3 },
  },
  accent: {
    mode: "user",
    default: "#6750A4",
    presets: ACCENT_PRESETS,
    tintSurfaces: true,
  },
  availableOn: ["android", "web"],
};
