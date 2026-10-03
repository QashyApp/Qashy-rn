import {
  ACCENT_PRESETS,
  CATEGORY_PALETTE,
  QASHY_INDIGO,
  darkTokens,
  iconSize,
  lightTokens,
  motion,
  radius,
  space,
  tile,
  typeScale,
} from "@/theme/tokens";
import type { ShadowSet, ThemeDefinition } from "@/theme/themes/types";

const lightShadows: ShadowSet = {
  shadowCard:
    "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 2px rgba(25, 27, 32, 0.06), 0 8px 20px -10px rgba(25, 27, 32, 0.14)",
  shadowRaised:
    "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 4px rgba(25, 27, 32, 0.06), 0 14px 32px -12px rgba(25, 27, 32, 0.20)",
  shadowControl:
    "inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(25, 27, 32, 0.10), 0 3px 8px -3px rgba(25, 27, 32, 0.16)",
  shadowControlPressed:
    "inset 0 2px 4px rgba(25, 27, 32, 0.16), inset 0 0 0 1px rgba(25, 27, 32, 0.04)",
  shadowSunken:
    "inset 0 1px 3px rgba(25, 27, 32, 0.12), inset 0 -1px 0 rgba(255, 255, 255, 0.7)",
  shadowOverlay: "0 20px 48px rgba(25, 27, 32, 0.18)",
  shadowFab:
    "inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 4px 14px rgba(25, 27, 32, 0.28)",
  scrim: "rgba(12, 13, 17, 0.42)",
};

const darkShadows: ShadowSet = {
  shadowCard:
    "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 1px 0 rgba(0, 0, 0, 0.45), 0 10px 24px -12px rgba(0, 0, 0, 0.7)",
  shadowRaised:
    "inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 16px 36px -12px rgba(0, 0, 0, 0.75)",
  shadowControl:
    "inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.5)",
  shadowControlPressed: "inset 0 2px 5px rgba(0, 0, 0, 0.55)",
  shadowSunken:
    "inset 0 1px 3px rgba(0, 0, 0, 0.55), inset 0 -1px 0 rgba(255, 255, 255, 0.04)",
  shadowOverlay: "0 22px 52px rgba(0, 0, 0, 0.6)",
  shadowFab:
    "inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 6px 18px rgba(0, 0, 0, 0.58)",
  scrim: "rgba(0, 0, 0, 0.56)",
};

/** The shipped soft-and-tactile look. Every other theme is measured against it. */
export const classicTheme: ThemeDefinition = {
  id: "classic",
  name: "Classic",
  palette: { light: lightTokens, dark: darkTokens },
  shadows: { light: lightShadows, dark: darkShadows },
  space,
  radius,
  tile,
  iconSize,
  motion,
  material: {
    engine: "soft",
    card: "elevated",
    gradients: true,
    bevelDepth: 0,
  },
  type: {
    text: { family: "rubik", fallbacks: [] },
    numeric: { family: "space-grotesk", fallbacks: ["rubik"] },
    scale: typeScale,
  },
  icons: { set: "ionicons", badge: "tinted", badgeShape: "squircle" },
  charts: {
    lineWidth: 2.5,
    sparklineWidth: 2,
    lineCap: "round",
    donutThickness: 16,
    gridDash: "4 4",
    patterns: false,
    categoryPalette: CATEGORY_PALETTE,
    tone: { containerMix: { light: 0.86, dark: 0.78 }, minContrast: 3 },
  },
  accent: { mode: "user", default: QASHY_INDIGO, presets: ACCENT_PRESETS },
};
