import { FONT_REGISTRY, scriptsCovered } from "@/theme/fonts";
import { ICON_SET_IDS } from "@/theme/icon-sets";
import { shadowBlurs } from "@/theme/shadow";
import {
  isValidThemeId,
  type ThemeDefinition,
  type ThemeScheme,
} from "@/theme/themes/types";
import {
  darkTokens,
  iconSize as classicIconSize,
  radius as classicRadius,
  space as classicSpace,
  tile as classicTile,
} from "@/theme/tokens";

const SCHEMES: readonly ThemeScheme[] = ["light", "dark"];
const HEX = /^#[0-9A-Fa-f]{6}$/;
const GRID_DASH = /^(\d+(\.\d+)?)( \d+(\.\d+)?)*$|^$/;

const PALETTE_KEYS = Object.keys(darkTokens);
const SHADOW_KEYS = [
  "shadowCard",
  "shadowRaised",
  "shadowControl",
  "shadowControlPressed",
  "shadowSunken",
  "shadowOverlay",
  "shadowFab",
  "scrim",
] as const;

function assertScale(
  theme: ThemeDefinition,
  name: "space" | "radius" | "tile" | "iconSize",
  reference: object,
) {
  const scale = theme[name] as unknown as Record<string, unknown> | undefined;
  if (!scale) throw new Error(`Theme "${theme.id}" must define ${name}.`);
  for (const key of Object.keys(reference)) {
    const value = scale[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `Theme "${theme.id}" ${name}.${key} must be a non-negative number.`,
      );
    }
  }
}

function assertMotion(theme: ThemeDefinition) {
  const motion = theme.motion;
  const positive = (value: unknown, path: string) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Theme "${theme.id}" motion.${path} must be a positive number.`,
      );
    }
  };
  if (!motion) throw new Error(`Theme "${theme.id}" must define motion.`);
  for (const key of ["fast", "base", "slow"] as const)
    positive(motion.duration?.[key], `duration.${key}`);
  for (const key of ["snappy", "gentle", "emphasized"] as const) {
    for (const field of ["damping", "stiffness", "mass"] as const)
      positive(motion.spring?.[key]?.[field], `spring.${key}.${field}`);
  }
  positive(motion.pressScale, "pressScale");
  if (motion.pressScale > 1)
    throw new Error(`Theme "${theme.id}" motion.pressScale must be at most 1.`);
  if (
    motion.press !== "scale" &&
    motion.press !== "translate" &&
    motion.press !== "overlay"
  ) {
    throw new Error(
      `Theme "${theme.id}" motion.press must be "scale", "translate" or "overlay".`,
    );
  }
  if (
    typeof motion.pressTranslate !== "number" ||
    !Number.isFinite(motion.pressTranslate) ||
    motion.pressTranslate < 0 ||
    motion.pressTranslate > 8
  ) {
    throw new Error(
      `Theme "${theme.id}" motion.pressTranslate must be a number from 0 to 8.`,
    );
  }
}

function assertMaterial(theme: ThemeDefinition) {
  const material = theme.material;
  if (!material) throw new Error(`Theme "${theme.id}" must define material.`);
  if (
    material.engine !== "soft" &&
    material.engine !== "bevel" &&
    material.engine !== "flat"
  ) {
    throw new Error(
      `Theme "${theme.id}" material.engine must be "soft", "bevel" or "flat".`,
    );
  }
  if (!["elevated", "outlined", "tonal"].includes(material.card)) {
    throw new Error(
      `Theme "${theme.id}" material.card must be "elevated", "outlined" or "tonal".`,
    );
  }
  if (material.engine === "flat" && material.gradients) {
    throw new Error(
      `Theme "${theme.id}" material.gradients must be false for the flat engine.`,
    );
  }
  if (typeof material.gradients !== "boolean")
    throw new Error(
      `Theme "${theme.id}" material.gradients must be a boolean.`,
    );
  if (
    typeof material.bevelDepth !== "number" ||
    !Number.isFinite(material.bevelDepth) ||
    material.bevelDepth < 0 ||
    material.bevelDepth > 8
  ) {
    throw new Error(
      `Theme "${theme.id}" material.bevelDepth must be a number from 0 to 8.`,
    );
  }
  if (material.engine === "bevel") {
    if (material.bevelDepth < 1)
      throw new Error(
        `Theme "${theme.id}" material.bevelDepth must be at least 1 for the bevel engine.`,
      );
    for (const scheme of SCHEMES) {
      for (const key of SHADOW_KEYS) {
        if (key === "scrim") continue;
        if (shadowBlurs(theme.shadows[scheme][key]).some((blur) => blur > 0)) {
          throw new Error(
            `Theme "${theme.id}" shadows.${scheme}.${key} must have no blur for the bevel engine.`,
          );
        }
      }
    }
  }
}

function assertCharts(theme: ThemeDefinition) {
  const charts = theme.charts;
  if (!charts) throw new Error(`Theme "${theme.id}" must define charts.`);
  const positive = (value: unknown, path: string) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Theme "${theme.id}" charts.${path} must be a positive number.`,
      );
    }
  };
  positive(charts.lineWidth, "lineWidth");
  if (charts.sparklineWidth !== undefined)
    positive(charts.sparklineWidth, "sparklineWidth");
  positive(charts.donutThickness, "donutThickness");
  if (
    charts.lineCap !== "round" &&
    charts.lineCap !== "butt" &&
    charts.lineCap !== "square"
  ) {
    throw new Error(
      `Theme "${theme.id}" charts.lineCap must be "round", "butt" or "square".`,
    );
  }
  if (typeof charts.gridDash !== "string" || !GRID_DASH.test(charts.gridDash)) {
    throw new Error(
      `Theme "${theme.id}" charts.gridDash must be an SVG dash array like "4 4", or empty for solid.`,
    );
  }
  if (typeof charts.patterns !== "boolean")
    throw new Error(`Theme "${theme.id}" charts.patterns must be a boolean.`);
  if (
    !Array.isArray(charts.categoryPalette) ||
    charts.categoryPalette.length < 6 ||
    charts.categoryPalette.some(
      (value) => typeof value !== "string" || !HEX.test(value),
    )
  ) {
    throw new Error(
      `Theme "${theme.id}" charts.categoryPalette must hold at least 6 #RRGGBB colors.`,
    );
  }
  const tone = charts.tone;
  for (const scheme of SCHEMES) {
    const mix = tone?.containerMix?.[scheme];
    if (typeof mix !== "number" || !(mix > 0 && mix < 1)) {
      throw new Error(
        `Theme "${theme.id}" charts.tone.containerMix.${scheme} must be a number between 0 and 1 (exclusive).`,
      );
    }
  }
  for (const scheme of SCHEMES) {
    const mix = tone.containerMix[scheme];
    if (mix < 0.4 || mix > 0.95) {
      throw new Error(
        `Theme "${theme.id}" charts.tone.containerMix.${scheme} must be between 0.4 and 0.95.`,
      );
    }
  }
  if (
    typeof tone.minContrast !== "number" ||
    !Number.isFinite(tone.minContrast) ||
    tone.minContrast < 3
  ) {
    throw new Error(
      `Theme "${theme.id}" charts.tone.minContrast must be at least 3.`,
    );
  }
}

// ---- type: font stacks, scale, script coverage ----

const TYPE_VARIANTS = [
  "hero",
  "display",
  "title",
  "money",
  "headline",
  "body",
  "label",
  "figure",
  "caption",
  "overline",
  "eyebrow",
] as const;
const TYPE_WEIGHTS = ["regular", "medium", "semibold", "bold"];

function assertType(theme: ThemeDefinition) {
  const type = theme.type;
  if (!type) throw new Error(`Theme "${theme.id}" must define type.`);

  for (const role of ["text", "numeric"] as const) {
    const stack = type[role];
    if (
      !stack ||
      typeof stack.family !== "string" ||
      !Array.isArray(stack.fallbacks)
    ) {
      throw new Error(
        `Theme "${theme.id}" type.${role} must be { family, fallbacks }.`,
      );
    }
    for (const id of [stack.family, ...stack.fallbacks]) {
      if (!Object.prototype.hasOwnProperty.call(FONT_REGISTRY, id)) {
        throw new Error(
          `Theme "${theme.id}" type.${role} uses unknown font "${String(id)}".`,
        );
      }
    }
  }

  for (const variant of TYPE_VARIANTS) {
    const style = type.scale?.[variant];
    const path = `type.scale.${variant}`;
    if (!style) throw new Error(`Theme "${theme.id}" must define ${path}.`);
    if (
      typeof style.fontSize !== "number" ||
      !Number.isFinite(style.fontSize) ||
      style.fontSize <= 0
    ) {
      throw new Error(
        `Theme "${theme.id}" ${path}.fontSize must be a positive number.`,
      );
    }
    if (
      typeof style.lineHeight !== "number" ||
      !Number.isFinite(style.lineHeight) ||
      style.lineHeight < style.fontSize
    ) {
      throw new Error(
        `Theme "${theme.id}" ${path}.lineHeight must be a number of at least fontSize.`,
      );
    }
    if (!TYPE_WEIGHTS.includes(style.weight)) {
      throw new Error(
        `Theme "${theme.id}" ${path}.weight must be regular, medium, semibold or bold.`,
      );
    }
    if (
      typeof style.letterSpacing !== "number" ||
      !Number.isFinite(style.letterSpacing)
    ) {
      throw new Error(
        `Theme "${theme.id}" ${path}.letterSpacing must be a finite number.`,
      );
    }
  }

  // The app ships Hebrew; a text stack that cannot render it would show tofu. The numeric
  // stack only renders digits, so it may be Latin-only.
  const covered = scriptsCovered(type);
  if (!covered.has("hebrew") || !covered.has("latin")) {
    throw new Error(
      `Theme "${theme.id}" type.text must cover Hebrew and Latin (directly or through a fallback font); it covers ${[...covered].join(", ") || "nothing"}.`,
    );
  }
}

function assertIcons(theme: ThemeDefinition) {
  const set = theme.icons?.set;
  if (typeof set !== "string" || !ICON_SET_IDS.includes(set)) {
    throw new Error(
      `Theme "${theme.id}" icons.set must be a registered icon set (${ICON_SET_IDS.join(", ")}).`,
    );
  }
  const categorySet = theme.icons.categorySet;
  if (
    categorySet !== undefined &&
    (typeof categorySet !== "string" || !ICON_SET_IDS.includes(categorySet))
  ) {
    throw new Error(
      `Theme "${theme.id}" icons.categorySet must be a registered icon set (${ICON_SET_IDS.join(", ")}).`,
    );
  }
  if (!["tinted", "filled", "none"].includes(theme.icons.badge)) {
    throw new Error(
      `Theme "${theme.id}" icons.badge must be "tinted", "filled" or "none".`,
    );
  }
  if (!["circle", "squircle"].includes(theme.icons.badgeShape)) {
    throw new Error(
      `Theme "${theme.id}" icons.badgeShape must be "circle" or "squircle".`,
    );
  }
}

/**
 * Throws on the first thing wrong with a theme, naming the path. A theme is all-or-nothing:
 * the loader never applies a partly valid one, so a typo cannot produce a half-themed app.
 */
export function assertThemeDefinition(theme: ThemeDefinition): void {
  if (!isValidThemeId(theme.id))
    throw new Error(`Theme id "${String(theme.id)}" is invalid.`);
  if (typeof theme.name !== "string" || !theme.name.trim())
    throw new Error(`Theme "${theme.id}" needs a name.`);

  for (const scheme of SCHEMES) {
    const palette = theme.palette?.[scheme];
    if (!palette)
      throw new Error(`Theme "${theme.id}" must define palette.${scheme}.`);
    for (const key of PALETTE_KEYS) {
      const value = (palette as unknown as Record<string, unknown>)[key];
      if (typeof value !== "string" || !HEX.test(value)) {
        throw new Error(
          `Theme "${theme.id}" palette.${scheme}.${key} must be a #RRGGBB color.`,
        );
      }
    }
    const shadows = theme.shadows?.[scheme];
    if (!shadows)
      throw new Error(`Theme "${theme.id}" must define shadows.${scheme}.`);
    for (const key of SHADOW_KEYS) {
      if (typeof shadows[key] !== "string" || !shadows[key].trim()) {
        throw new Error(
          `Theme "${theme.id}" shadows.${scheme}.${key} must be a non-empty string.`,
        );
      }
    }
  }

  assertScale(theme, "space", classicSpace);
  assertScale(theme, "radius", classicRadius);
  assertScale(theme, "tile", classicTile);
  assertScale(theme, "iconSize", classicIconSize);
  assertMotion(theme);
  assertMaterial(theme);
  assertIcons(theme);
  assertType(theme);
  assertCharts(theme);

  if (!["user", "fixed", "system"].includes(theme.accent?.mode)) {
    throw new Error(
      `Theme "${theme.id}" accent.mode must be "user", "fixed" or "system".`,
    );
  }
  if (
    typeof theme.accent?.default !== "string" ||
    !HEX.test(theme.accent.default)
  ) {
    throw new Error(
      `Theme "${theme.id}" accent.default must be a #RRGGBB color.`,
    );
  }
  if (
    !Array.isArray(theme.accent.presets) ||
    theme.accent.presets.some((value) => !HEX.test(value))
  ) {
    throw new Error(
      `Theme "${theme.id}" accent.presets must be #RRGGBB colors.`,
    );
  }
}
