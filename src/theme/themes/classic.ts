import { NO_SHADOW } from "@/theme/shadow";
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

/**
 * The Dew elevation ladder.
 *
 * Depth is quiet. A card keeps a whisper of shadow — wide, faint, offset down — so the tonal
 * steps in the palette do most of the separating and the shadow only hints at the plane. Controls
 * and wells are flat (no drop shadow at all): their feedback is the state layer, the Android
 * ripple and the press sink, not a lit edge. Cards float; buttons do not.
 */
const lightShadows: ShadowSet = {
  shadowCard:
    "inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(26, 27, 48, 0.04), 0 10px 24px -14px rgba(26, 27, 48, 0.1)",
  shadowRaised:
    "inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 2px 4px rgba(26, 27, 48, 0.05), 0 16px 36px -18px rgba(26, 27, 48, 0.14)",
  shadowControl: NO_SHADOW,
  shadowControlPressed: NO_SHADOW,
  shadowSunken: NO_SHADOW,
  shadowOverlay: "0 16px 40px rgba(26, 27, 48, 0.16)",
  shadowFab: "0 4px 14px rgba(26, 27, 48, 0.22)",
  scrim: "rgba(18, 18, 33, 0.42)",
};

const darkShadows: ShadowSet = {
  shadowCard:
    "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 12px 28px -14px rgba(0, 0, 0, 0.65)",
  shadowRaised:
    "inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 18px 40px -18px rgba(0, 0, 0, 0.7)",
  shadowControl: NO_SHADOW,
  shadowControlPressed: NO_SHADOW,
  shadowSunken: NO_SHADOW,
  shadowOverlay: "0 20px 48px rgba(0, 0, 0, 0.55)",
  shadowFab: "0 5px 16px rgba(0, 0, 0, 0.5)",
  scrim: "rgba(0, 0, 0, 0.56)",
};

/**
 * The Dew look: violet-leaning neutral surfaces, whisper-soft card elevation, flat controls,
 * filled Material category glyphs and a friendly Figtree face. Every other theme is measured
 * against it.
 */
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
    // Cards keep their soft depth; controls, wells and accent fills are flat — no gradient, no
    // accent shadow — and answer with a state layer, the Android ripple and the press sink.
    gradients: false,
    bevelDepth: 0,
    stateLayers: true,
    flatAccent: true,
  },
  type: {
    text: { family: "figtree", fallbacks: ["rubik"] },
    numeric: { family: "figtree", fallbacks: ["rubik"] },
    scale: typeScale,
  },
  icons: {
    set: "ionicons",
    categorySet: "material",
    badge: "filled",
    badgeShape: "squircle",
  },
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
