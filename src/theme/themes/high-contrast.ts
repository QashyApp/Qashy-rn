import { serializeShadow } from "@/theme/shadow";
import {
  iconSize,
  motion,
  tile,
  typeScale,
  type BaseTokens,
} from "@/theme/tokens";
import type {
  RadiusScale,
  ShadowSet,
  SpaceScale,
  ThemeDefinition,
  TypeScaleSpec,
} from "@/theme/themes/types";

// Accessibility theme: 7:1 text, strongly visible borders, flat hard outlines instead of soft light.
// Every shadow is a zero-blur ring, so a surface is defined by its edge, not by its glow.

const lightPalette: BaseTokens = {
  background: "#F0F0F0",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#E2E2E2",
  surfaceSunken: "#E8E8E8",
  text: "#000000",
  textMuted: "#383838",
  border: "#505050",
  positive: "#005F26",
  negative: "#B3001B",
  warning: "#7A4400",
  transfer: "#0A3FBF",
  secondaryContainer: "#E2E2E2",
  onSecondaryContainer: "#000000",
  tertiaryContainer: "#E1E8FA",
  onTertiaryContainer: "#0A3FBF",
  headerBackground: "#F0F0F0",
  navBackground: "#FFFFFF",
};

const darkPalette: BaseTokens = {
  background: "#000000",
  surface: "#0B0B0B",
  surfaceElevated: "#161616",
  surfaceMuted: "#242424",
  surfaceSunken: "#000000",
  text: "#FFFFFF",
  textMuted: "#D6D6D6",
  border: "#B8B8B8",
  positive: "#5CF08F",
  negative: "#FF8D9A",
  warning: "#FFD25A",
  transfer: "#8FB6FF",
  secondaryContainer: "#242424",
  onSecondaryContainer: "#FFFFFF",
  tertiaryContainer: "#16213D",
  onTertiaryContainer: "#8FB6FF",
  headerBackground: "#000000",
  navBackground: "#161616",
};

export function outlineShadows(palette: BaseTokens, scrim: string): ShadowSet {
  const ring = (width: number, color: string) =>
    serializeShadow([
      { inset: true, x: 0, y: 0, blur: 0, spread: width, color },
    ]);
  return {
    shadowCard: ring(2, palette.border),
    shadowRaised: ring(2, palette.text),
    shadowControl: ring(2, palette.text),
    shadowControlPressed: ring(3, palette.text),
    shadowSunken: ring(2, palette.border),
    shadowOverlay: ring(3, palette.text),
    shadowFab: ring(3, palette.text),
    scrim,
  };
}

const space: SpaceScale = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};
const radius: RadiusScale = {
  sm: 6,
  control: 8,
  tile: 8,
  card: 12,
  sheet: 16,
  nav: 10,
  fab: 999,
  pill: 999,
};

const scale: TypeScaleSpec = {
  ...typeScale,
  body: { fontSize: 17, lineHeight: 24, weight: "regular", letterSpacing: 0 },
  label: { fontSize: 16, lineHeight: 22, weight: "medium", letterSpacing: 0 },
  caption: {
    fontSize: 14,
    lineHeight: 20,
    weight: "regular",
    letterSpacing: 0,
  },
  overline: {
    fontSize: 14,
    lineHeight: 20,
    weight: "medium",
    letterSpacing: 0,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    weight: "semibold",
    letterSpacing: 0.6,
  },
};

export const highContrastTheme: ThemeDefinition = {
  id: "high-contrast",
  name: "High contrast",
  palette: { light: lightPalette, dark: darkPalette },
  shadows: {
    light: outlineShadows(lightPalette, "rgba(0, 0, 0, 0.8)"),
    dark: outlineShadows(darkPalette, "rgba(0, 0, 0, 0.88)"),
  },
  space,
  radius,
  tile,
  iconSize,
  motion: { ...motion, press: "scale" },
  material: {
    engine: "soft",
    card: "elevated",
    gradients: false,
    bevelDepth: 0,
  },
  type: {
    text: { family: "rubik", fallbacks: [] },
    numeric: { family: "space-grotesk", fallbacks: ["rubik"] },
    scale,
  },
  icons: { set: "ionicons", badge: "tinted", badgeShape: "squircle" },
  charts: {
    lineWidth: 3,
    sparklineWidth: 3,
    lineCap: "round",
    donutThickness: 18,
    gridDash: "",
    patterns: true,
    categoryPalette: [
      "#0A3FBF",
      "#B3001B",
      "#005F26",
      "#7A4400",
      "#6A1B9A",
      "#00606B",
      "#000000",
      "#8A2C00",
    ],
    tone: { containerMix: { light: 0.9, dark: 0.82 }, minContrast: 4.5 },
  },
  // A single accent cannot clear 4.5:1 on both a white and a black surface; accentTokens lifts it
  // per scheme (to 3:1), and the palette, not the accent, carries the contrast guarantee.
  accent: { mode: "fixed", default: "#3366FF", presets: [] },
};
