import { clampPaletteContrast } from "@/theme/custom/contrast";
import { FONT_REGISTRY, stackFor } from "@/theme/fonts";
import { ICON_SET_IDS } from "@/theme/icon-sets";
import { bevelShadowSet, flatShadowSet } from "@/theme/shadow";
import { BUILT_IN_THEMES } from "@/theme/themes/registry";
import { classicTheme } from "@/theme/themes/classic";
import { outlineShadows } from "@/theme/themes/high-contrast";
import {
  THEME_ID_PATTERN,
  type ChartSpec,
  type IconBadgeShape,
  type IconBadgeStyle,
  type MaterialSpec,
  type MotionSpec,
  type RadiusScale,
  type ShadowSet,
  type SpaceScale,
  type ThemeDefinition,
  type ThemeScheme,
  type TileScale,
  type TypeScaleSpec,
  type TypeStyleSpec,
} from "@/theme/themes/types";
import { assertThemeDefinition } from "@/theme/themes/validate";
import {
  ROLE_TOKEN_KEYS,
  darkTokens,
  derivedRoleTokens,
  type BaseTokens,
  type FontWeightName,
} from "@/theme/tokens";

/**
 * User-authored themes: a versioned, declarative JSON file that is validated, merged over a
 * built-in theme, contrast-clamped and turned into an ordinary `ThemeDefinition`.
 *
 * Design rules:
 * - Fail closed. If ANY field is invalid the whole theme is rejected with path-addressed errors.
 * - Unknown keys (top level or nested) are errors, so a typo never silently passes.
 * - Data only. Colors are `#RRGGBB`, numbers are range-checked, fonts and icon sets are ids from
 *   bundled registries. There is no field that accepts a URL, code, a data URI, a font file or
 *   an image, and any string that looks like one is rejected wherever it appears.
 * - Shadows are DERIVED (`soft` reuses a shadow set, `bevel` calls `bevelShadowSet`); raw shadow
 *   strings are never accepted.
 * - Never throws. `parseCustomTheme` returns `{ ok: false, errors }` instead.
 *
 * See docs/theming-plan.md, Phase 11.
 */

/**
 * The version this build writes. Version 1 files still parse; fields introduced by version 2 are
 * rejected in a version 1 file ("requires themeSchemaVersion 2"), so a file never silently
 * means different things in different versions.
 */
export const CUSTOM_THEME_SCHEMA_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;
export type CustomThemeSchemaVersion =
  (typeof SUPPORTED_SCHEMA_VERSIONS)[number];
export const MAX_CUSTOM_THEME_BYTES = 16 * 1024;
export const MAX_ACCENT_PRESETS = 12;

type Hex = string;

export interface CustomThemeFile {
  themeSchemaVersion: CustomThemeSchemaVersion;
  id: string;
  name: string;
  /** A built-in theme id. Defaults to `classic`. A custom theme cannot extend another custom theme. */
  extends?: string;
  /** Both schemes are required and non-empty. Unspecified keys inherit from the `extends` theme's same scheme. */
  palette: { light: Partial<BaseTokens>; dark: Partial<BaseTokens> };
  accent?: {
    /** `system` (version 2): the wallpaper accent on Android 12+, `default` everywhere else. */
    mode?: "user" | "fixed" | "system";
    default?: Hex;
    presets?: Hex[];
  };
  shape?: {
    radius?: Partial<RadiusScale>;
    space?: Partial<SpaceScale>;
    tile?: Partial<TileScale>;
  };
  material?: {
    /** `flat` (version 2): no gradients or drop shadows, depth from tonal steps and outlines. */
    engine?: "soft" | "bevel" | "flat";
    /** Version 2. */
    card?: MaterialSpec["card"];
    gradients?: boolean;
    bevelDepth?: number;
  };
  motion?: {
    /** `overlay` (version 2): a pressed control changes fill instead of moving. */
    press?: "scale" | "translate" | "overlay";
    pressScale?: number;
    pressTranslate?: number;
    durationScale?: number;
  };
  type?: {
    text?: { family: string };
    numeric?: { family: string };
    /** Version 2: per-variant overrides of the classic scale. */
    scale?: CustomTypeScale;
  };
  icons?: {
    set?: string;
    /** Version 2. */
    categorySet?: string;
    /** Version 2. */
    badge?: IconBadgeStyle;
    /** Version 2. */
    badgeShape?: IconBadgeShape;
  };
  charts?: {
    /** Version 2. */
    tone?: { containerMix?: { light?: number; dark?: number } };
    patterns?: boolean;
    lineWidth?: number;
    donutThickness?: number;
    gridDash?: string;
    lineCap?: "round" | "butt" | "square";
    categoryPalette?: Hex[];
  };
}

export type CustomTypeVariant =
  | "hero"
  | "display"
  | "title"
  | "money"
  | "headline"
  | "body"
  | "label"
  | "figure"
  | "caption"
  | "overline"
  | "eyebrow";
export type CustomTypeScale = Partial<
  Record<CustomTypeVariant, Partial<TypeStyleSpec>>
>;

export type CustomThemeParseResult =
  | {
      ok: true;
      file: CustomThemeFile;
      theme: ThemeDefinition;
      warnings: string[];
    }
  | { ok: false; errors: string[] };

const HEX = /^#[0-9A-Fa-f]{6}$/;
const GRID_DASH = /^$|^\d{1,2}( \d{1,2}){0,3}$/;

const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const DANGEROUS_STRING =
  /url\s*\(|javascript\s*:|\bdata\s*:|vbscript\s*:|https?\s*:|:\/\/|(?:^|\s)\/\/|<\s*script|expression\s*\(|@import/i;

const PALETTE_KEYS = Object.keys(darkTokens) as (keyof BaseTokens)[];
const BUILT_IN_IDS = BUILT_IN_THEMES.map((theme) => theme.id);

// ---- small validation toolkit ----

type Errors = string[];
type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readObject(
  value: unknown,
  path: string,
  allowed: readonly string[],
  errors: Errors,
): Obj | null {
  if (!isObject(value)) {
    errors.push(`${path}: must be an object`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      errors.push(
        `${path}.${key}: unknown key (allowed: ${allowed.join(", ")})`,
      );
  }
  return value;
}

function readNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: Errors,
  integer = false,
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    errors.push(
      `${path}: must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`,
    );
    return undefined;
  }
  return value;
}

function readHex(
  value: unknown,
  path: string,
  errors: Errors,
): string | undefined {
  if (typeof value !== "string" || !HEX.test(value)) {
    errors.push(`${path}: must be a #RRGGBB color`);
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  options: readonly T[],
  errors: Errors,
): T | undefined {
  if (typeof value !== "string" || !options.includes(value as T)) {
    errors.push(
      `${path}: must be one of ${options.map((option) => `"${option}"`).join(", ")}`,
    );
    return undefined;
  }
  return value as T;
}

function readBoolean(
  value: unknown,
  path: string,
  errors: Errors,
): boolean | undefined {
  if (typeof value !== "boolean") {
    errors.push(`${path}: must be true or false`);
    return undefined;
  }
  return value;
}

function readHexList(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: Errors,
): string[] | undefined {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    errors.push(
      `${path}: must be a list of ${min === max ? min : `${min} to ${max}`} #RRGGBB colors`,
    );
    return undefined;
  }
  let ok = true;
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !HEX.test(entry)) {
      errors.push(`${path}[${index}]: must be a #RRGGBB color`);
      ok = false;
    }
  });
  return ok ? (value as string[]) : undefined;
}

/** Rejects any string, key or nested value that looks like a URL, data URI or script, wherever it sits. */
function scanForDangerousStrings(
  value: unknown,
  path: string,
  errors: Errors,
  depth = 0,
): void {
  if (depth > 8) {
    errors.push(`${path}: nested too deeply`);
    return;
  }
  if (typeof value === "string") {
    if (DANGEROUS_STRING.test(value))
      errors.push(`${path}: must not contain a URL, data URI or script`);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanForDangerousStrings(entry, `${path}[${index}]`, errors, depth + 1),
    );
  } else if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (DANGEROUS_STRING.test(key))
        errors.push(
          `${path}.${key}: key must not contain a URL, data URI or script`,
        );
      scanForDangerousStrings(entry, `${path}.${key}`, errors, depth + 1);
    }
  }
}

// ---- field readers (each returns the validated slice, or undefined and pushes errors) ----

const RADIUS_RANGES: Record<keyof RadiusScale, number> = {
  sm: 64,
  control: 64,
  tile: 64,
  card: 64,
  sheet: 64,
  nav: 64,
  fab: 64,
  pill: 999,
};
const TYPE_VARIANTS: readonly CustomTypeVariant[] = [
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
];
const FONT_WEIGHTS: readonly FontWeightName[] = [
  "regular",
  "medium",
  "semibold",
  "bold",
];
const ICON_BADGE_STYLES: readonly IconBadgeStyle[] = [
  "tinted",
  "filled",
  "none",
];
const ICON_BADGE_SHAPES: readonly IconBadgeShape[] = ["circle", "squircle"];
const SPACE_KEYS: readonly (keyof SpaceScale)[] = [
  "xxs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "xxl",
  "xxxl",
];
const TILE_RANGES: Record<keyof TileScale, [number, number]> = {
  size: [32, 64],
  icon: [12, 40],
  compactSize: [28, 48],
  compactIcon: [12, 32],
};

const ROLE_SOURCE_KEYS = [
  "background",
  "surface",
  "surfaceElevated",
  "surfaceMuted",
  "text",
  "transfer",
] as const;

function readPalette(
  value: unknown,
  scheme: ThemeScheme,
  errors: Errors,
): Partial<BaseTokens> | undefined {
  const path = `palette.${scheme}`;
  const obj = readObject(value, path, PALETTE_KEYS, errors);
  if (!obj) return undefined;
  if (Object.keys(obj).length === 0) {
    errors.push(
      `${path}: must define at least one color (every theme must define both light and dark)`,
    );
    return undefined;
  }
  const out: Partial<BaseTokens> = {};
  for (const key of PALETTE_KEYS) {
    if (obj[key] === undefined) continue;
    const hex = readHex(obj[key], `${path}.${key}`, errors);
    if (hex !== undefined) out[key] = hex;
  }
  return out;
}

function readScale<T extends string>(
  value: unknown,
  path: string,
  keys: readonly T[],
  rangeOf: (key: T) => [number, number],
  errors: Errors,
): Partial<Record<T, number>> | undefined {
  const obj = readObject(value, path, keys, errors);
  if (!obj) return undefined;
  const out: Partial<Record<T, number>> = {};
  for (const key of keys) {
    if (obj[key] === undefined) continue;
    const [min, max] = rangeOf(key);
    const number = readNumber(obj[key], `${path}.${key}`, min, max, errors);
    if (number !== undefined) out[key] = number;
  }
  return out;
}

function readFontFamily(
  value: unknown,
  path: string,
  errors: Errors,
): { family: string } | undefined {
  const obj = readObject(value, path, ["family"], errors);
  if (!obj) return undefined;
  const family = obj.family;
  if (
    typeof family !== "string" ||
    !Object.prototype.hasOwnProperty.call(FONT_REGISTRY, family)
  ) {
    errors.push(
      `${path}.family: must be one of ${Object.keys(FONT_REGISTRY)
        .map((id) => `"${id}"`)
        .join(", ")}`,
    );
    return undefined;
  }
  return { family };
}

const TYPE_STYLE_KEYS = [
  "fontSize",
  "weight",
  "letterSpacing",
  "lineHeight",
] as const;

/** Bounded per-variant overrides; every bound keeps text legible and the layout intact. */
function readTypeScale(
  value: unknown,
  path: string,
  errors: Errors,
): CustomTypeScale | undefined {
  const obj = readObject(value, path, TYPE_VARIANTS, errors);
  if (!obj) return undefined;
  const out: CustomTypeScale = {};
  for (const variant of TYPE_VARIANTS) {
    if (obj[variant] === undefined) continue;
    const here = `${path}.${variant}`;
    const style = readObject(obj[variant], here, TYPE_STYLE_KEYS, errors);
    if (!style) continue;
    const entry: Partial<TypeStyleSpec> = {};
    if (style.fontSize !== undefined) {
      const fontSize = readNumber(
        style.fontSize,
        `${here}.fontSize`,
        9,
        72,
        errors,
      );
      if (fontSize !== undefined) entry.fontSize = fontSize;
    }
    if (style.lineHeight !== undefined) {
      const lineHeight = readNumber(
        style.lineHeight,
        `${here}.lineHeight`,
        10,
        96,
        errors,
      );
      if (lineHeight !== undefined) entry.lineHeight = lineHeight;
    }
    if (style.letterSpacing !== undefined) {
      const spacing = readNumber(
        style.letterSpacing,
        `${here}.letterSpacing`,
        -3,
        3,
        errors,
      );
      if (spacing !== undefined) entry.letterSpacing = spacing;
    }
    if (style.weight !== undefined) {
      const weight = readEnum(
        style.weight,
        `${here}.weight`,
        FONT_WEIGHTS,
        errors,
      );
      if (weight !== undefined) entry.weight = weight;
    }
    out[variant] = entry;
  }
  return out;
}

/**
 * Validates the raw shape. Returns the file (a JSON-clean copy) or null with errors pushed.
 * Everything is checked before returning so the author sees every problem at once.
 */
function readFile(input: unknown, errors: Errors): CustomThemeFile | null {
  const root = readObject(
    input,
    "$",
    [
      "themeSchemaVersion",
      "id",
      "name",
      "extends",
      "palette",
      "accent",
      "shape",
      "material",
      "motion",
      "type",
      "icons",
      "charts",
    ],
    errors,
  );
  if (!root) return null;

  const file: Partial<CustomThemeFile> = {};

  const version = SUPPORTED_SCHEMA_VERSIONS.find(
    (supported) => supported === root.themeSchemaVersion,
  );
  if (version === undefined) {
    errors.push(
      `themeSchemaVersion: must be ${SUPPORTED_SCHEMA_VERSIONS.join(" or ")}`,
    );
  } else {
    file.themeSchemaVersion = version;
  }
  // Fields added in version 2 are an error in a version 1 file rather than silently honoured.
  const needsV2 = (path: string) => {
    if (version === 1) errors.push(`${path}: requires themeSchemaVersion 2`);
  };

  if (typeof root.id !== "string" || !THEME_ID_PATTERN.test(root.id)) {
    errors.push(
      "id: must be lowercase letters, digits and hyphens, starting with a letter or digit, up to 48 characters",
    );
  } else if (BUILT_IN_IDS.includes(root.id)) {
    errors.push(`id: "${root.id}" is a built-in theme id; choose another`);
  } else {
    file.id = root.id;
  }

  if (
    typeof root.name !== "string" ||
    root.name.trim().length < 1 ||
    root.name.length > 40
  ) {
    errors.push("name: must be 1 to 40 characters");
  } else if (CONTROL_OR_BIDI.test(root.name)) {
    errors.push(
      "name: must not contain control or direction-override characters",
    );
  } else {
    file.name = root.name;
  }

  if (root.extends !== undefined) {
    if (
      typeof root.extends !== "string" ||
      !BUILT_IN_IDS.includes(root.extends)
    ) {
      errors.push(
        `extends: must be a built-in theme id (${BUILT_IN_IDS.join(", ")}); custom themes cannot extend custom themes`,
      );
    } else {
      file.extends = root.extends;
    }
  }

  const paletteObj = readObject(
    root.palette,
    "palette",
    ["light", "dark"],
    errors,
  );
  if (paletteObj) {
    const light = readPalette(paletteObj.light, "light", errors);
    const dark = readPalette(paletteObj.dark, "dark", errors);
    if (light && dark) file.palette = { light, dark };
  }

  if (root.accent !== undefined) {
    const accent = readObject(
      root.accent,
      "accent",
      ["mode", "default", "presets"],
      errors,
    );
    if (accent) {
      const out: NonNullable<CustomThemeFile["accent"]> = {};
      if (accent.mode !== undefined) {
        if (accent.mode === "system") needsV2('accent.mode "system"');
        out.mode = readEnum(
          accent.mode,
          "accent.mode",
          ["user", "fixed", "system"] as const,
          errors,
        );
      }
      if (accent.default !== undefined)
        out.default = readHex(accent.default, "accent.default", errors);
      if (accent.presets !== undefined)
        out.presets = readHexList(
          accent.presets,
          "accent.presets",
          0,
          MAX_ACCENT_PRESETS,
          errors,
        );
      file.accent = out;
    }
  }

  if (root.shape !== undefined) {
    const shape = readObject(
      root.shape,
      "shape",
      ["radius", "space", "tile"],
      errors,
    );
    if (shape) {
      const out: NonNullable<CustomThemeFile["shape"]> = {};
      if (shape.radius !== undefined) {
        if (isObject(shape.radius) && shape.radius.fab !== undefined)
          needsV2("shape.radius.fab");
        out.radius = readScale(
          shape.radius,
          "shape.radius",
          Object.keys(RADIUS_RANGES) as (keyof RadiusScale)[],
          (key) => [0, RADIUS_RANGES[key]],
          errors,
        );
      }
      if (shape.space !== undefined)
        out.space = readScale(
          shape.space,
          "shape.space",
          SPACE_KEYS,
          () => [0, 48],
          errors,
        );
      if (shape.tile !== undefined) {
        out.tile = readScale(
          shape.tile,
          "shape.tile",
          Object.keys(TILE_RANGES) as (keyof TileScale)[],
          (key) => TILE_RANGES[key],
          errors,
        );
      }
      file.shape = out;
    }
  }

  if (root.material !== undefined) {
    const material = readObject(
      root.material,
      "material",
      ["engine", "card", "gradients", "bevelDepth"],
      errors,
    );
    if (material) {
      const out: NonNullable<CustomThemeFile["material"]> = {};
      if (material.engine !== undefined) {
        if (material.engine === "flat") needsV2('material.engine "flat"');
        out.engine = readEnum(
          material.engine,
          "material.engine",
          ["soft", "bevel", "flat"] as const,
          errors,
        );
      }
      if (material.card !== undefined) {
        needsV2("material.card");
        out.card = readEnum(
          material.card,
          "material.card",
          ["elevated", "outlined", "tonal"] as const,
          errors,
        );
      }
      if (material.gradients !== undefined)
        out.gradients = readBoolean(
          material.gradients,
          "material.gradients",
          errors,
        );
      if (material.bevelDepth !== undefined)
        out.bevelDepth = readNumber(
          material.bevelDepth,
          "material.bevelDepth",
          1,
          4,
          errors,
          true,
        );
      file.material = out;
    }
  }

  if (root.motion !== undefined) {
    const motion = readObject(
      root.motion,
      "motion",
      ["press", "pressScale", "pressTranslate", "durationScale"],
      errors,
    );
    if (motion) {
      const out: NonNullable<CustomThemeFile["motion"]> = {};
      if (motion.press !== undefined) {
        if (motion.press === "overlay") needsV2('motion.press "overlay"');
        out.press = readEnum(
          motion.press,
          "motion.press",
          ["scale", "translate", "overlay"] as const,
          errors,
        );
      }
      if (motion.pressScale !== undefined)
        out.pressScale = readNumber(
          motion.pressScale,
          "motion.pressScale",
          0.9,
          1,
          errors,
        );
      if (motion.pressTranslate !== undefined)
        out.pressTranslate = readNumber(
          motion.pressTranslate,
          "motion.pressTranslate",
          0,
          8,
          errors,
        );
      if (motion.durationScale !== undefined)
        out.durationScale = readNumber(
          motion.durationScale,
          "motion.durationScale",
          0.5,
          2,
          errors,
        );
      file.motion = out;
    }
  }

  if (root.type !== undefined) {
    const type = readObject(
      root.type,
      "type",
      ["text", "numeric", "scale"],
      errors,
    );
    if (type) {
      const out: NonNullable<CustomThemeFile["type"]> = {};
      if (type.text !== undefined)
        out.text = readFontFamily(type.text, "type.text", errors);
      if (type.numeric !== undefined)
        out.numeric = readFontFamily(type.numeric, "type.numeric", errors);
      if (type.scale !== undefined) {
        needsV2("type.scale");
        out.scale = readTypeScale(type.scale, "type.scale", errors);
      }
      file.type = out;
    }
  }

  if (root.icons !== undefined) {
    const icons = readObject(
      root.icons,
      "icons",
      ["set", "categorySet", "badge", "badgeShape"],
      errors,
    );
    if (icons) {
      const out: NonNullable<CustomThemeFile["icons"]> = {};
      const readSet = (key: "set" | "categorySet") => {
        const id = icons[key];
        if (typeof id !== "string" || !ICON_SET_IDS.includes(id)) {
          errors.push(
            `icons.${key}: must be one of ${ICON_SET_IDS.map((known) => `"${known}"`).join(", ")}`,
          );
          return undefined;
        }
        return id;
      };
      if (icons.set !== undefined || version === 1) out.set = readSet("set");
      if (icons.categorySet !== undefined) {
        needsV2("icons.categorySet");
        out.categorySet = readSet("categorySet");
      }
      if (icons.badge !== undefined) {
        needsV2("icons.badge");
        out.badge = readEnum(
          icons.badge,
          "icons.badge",
          ICON_BADGE_STYLES,
          errors,
        );
      }
      if (icons.badgeShape !== undefined) {
        needsV2("icons.badgeShape");
        out.badgeShape = readEnum(
          icons.badgeShape,
          "icons.badgeShape",
          ICON_BADGE_SHAPES,
          errors,
        );
      }
      file.icons = out;
    }
  }

  if (root.charts !== undefined) {
    const charts = readObject(
      root.charts,
      "charts",
      [
        "patterns",
        "lineWidth",
        "donutThickness",
        "gridDash",
        "lineCap",
        "categoryPalette",
        "tone",
      ],
      errors,
    );
    if (charts) {
      const out: NonNullable<CustomThemeFile["charts"]> = {};
      if (charts.tone !== undefined) {
        needsV2("charts.tone");
        const tone = readObject(
          charts.tone,
          "charts.tone",
          ["containerMix"],
          errors,
        );
        if (tone && tone.containerMix !== undefined) {
          const mix = readObject(
            tone.containerMix,
            "charts.tone.containerMix",
            ["light", "dark"],
            errors,
          );
          if (mix) {
            const outMix: { light?: number; dark?: number } = {};
            for (const key of ["light", "dark"] as const) {
              if (mix[key] === undefined) continue;
              outMix[key] = readNumber(
                mix[key],
                `charts.tone.containerMix.${key}`,
                0.4,
                0.95,
                errors,
              );
            }
            out.tone = { containerMix: outMix };
          }
        }
      }
      if (charts.patterns !== undefined)
        out.patterns = readBoolean(charts.patterns, "charts.patterns", errors);
      if (charts.lineWidth !== undefined)
        out.lineWidth = readNumber(
          charts.lineWidth,
          "charts.lineWidth",
          1,
          6,
          errors,
        );
      if (charts.donutThickness !== undefined)
        out.donutThickness = readNumber(
          charts.donutThickness,
          "charts.donutThickness",
          8,
          32,
          errors,
        );
      if (charts.gridDash !== undefined) {
        if (
          typeof charts.gridDash !== "string" ||
          !GRID_DASH.test(charts.gridDash)
        ) {
          errors.push(
            'charts.gridDash: must be up to four numbers separated by spaces, like "4 4", or "" for solid',
          );
        } else {
          out.gridDash = charts.gridDash;
        }
      }
      if (charts.lineCap !== undefined)
        out.lineCap = readEnum(
          charts.lineCap,
          "charts.lineCap",
          ["round", "butt", "square"] as const,
          errors,
        );
      if (charts.categoryPalette !== undefined)
        out.categoryPalette = readHexList(
          charts.categoryPalette,
          "charts.categoryPalette",
          6,
          12,
          errors,
        );
      file.charts = out;
    }
  }

  return file as CustomThemeFile;
}

// ---- building the ThemeDefinition ----

function pickDefined<T extends object>(
  base: T,
  override: Partial<T> | undefined,
): T {
  const out = { ...base };
  if (!override) return out;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const value = override[key];
    if (value !== undefined) out[key] = value as T[keyof T];
  }
  return out;
}

function deriveShadows(
  scheme: ThemeScheme,
  palette: BaseTokens,
  base: ThemeDefinition,
  engine: MaterialSpec["engine"],
  bevelDepth: number,
): ShadowSet {
  if (engine === "bevel") return bevelShadowSet(palette, scheme, bevelDepth);
  // Flat: no drop shadows; rings follow the merged palette border.
  if (engine === "flat") return flatShadowSet(palette, scheme);
  // Soft. A bevel or flat base's shadows are not the soft ladder, so fall back to the neutral classic set.
  // High contrast draws its rings in the palette's own colors, so they are re-derived from the
  // merged palette rather than copied (a copy would ring in the BASE theme's colors).
  if (base.material.engine === "bevel" || base.material.engine === "flat")
    return classicTheme.shadows[scheme];
  if (base.id === "high-contrast")
    return outlineShadows(palette, base.shadows[scheme].scrim);
  return base.shadows[scheme];
}

function buildTheme(
  file: CustomThemeFile,
  base: ThemeDefinition,
): { theme: ThemeDefinition; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const palette = {} as Record<ThemeScheme, BaseTokens>;
  for (const scheme of ["light", "dark"] as const) {
    const authored = file.palette[scheme];
    let merged = pickDefined(base.palette[scheme], authored);
    // A theme that changes the surfaces but not the Material style roles gets roles derived from
    // its own colors, so the header and tab bar follow the palette instead of the base theme's.
    if (ROLE_SOURCE_KEYS.some((key) => authored[key] !== undefined)) {
      const derived = derivedRoleTokens(merged, scheme === "dark");
      const roles: Partial<BaseTokens> = {};
      for (const key of ROLE_TOKEN_KEYS)
        if (authored[key] === undefined) roles[key] = derived[key];
      merged = { ...merged, ...roles };
    }
    const clamped = clampPaletteContrast(scheme, merged);
    palette[scheme] = clamped.palette;
    warnings.push(...clamped.warnings);
    errors.push(...clamped.unsatisfied);
  }

  const space = pickDefined(base.space, file.shape?.space) as SpaceScale;
  const radius = pickDefined(base.radius, file.shape?.radius) as RadiusScale;
  const tile = pickDefined(base.tile, file.shape?.tile) as TileScale;
  if (tile.icon > tile.size)
    errors.push("shape.tile.icon: must not be larger than shape.tile.size");
  if (tile.compactIcon > tile.compactSize)
    errors.push(
      "shape.tile.compactIcon: must not be larger than shape.tile.compactSize",
    );

  const baseMaterial = base.material;
  const engine = file.material?.engine ?? baseMaterial.engine;
  const bevelDepth =
    engine === "bevel"
      ? (file.material?.bevelDepth ??
        (baseMaterial.engine === "bevel" ? baseMaterial.bevelDepth : 2))
      : 0;
  const material: MaterialSpec = {
    engine,
    card: file.material?.card ?? baseMaterial.card,
    // A flat look has no gradients unless the author insists (which is then an error below).
    gradients:
      file.material?.gradients ??
      (engine === "flat" ? false : baseMaterial.gradients),
    bevelDepth,
  };
  if (engine === "flat" && material.gradients)
    errors.push(
      'material.gradients: must be false when material.engine is "flat"',
    );

  // Switching the press style needs a value that actually moves the control, so inherit a sane
  // one when the base theme's value is the "off" value for the new style.
  // A flat theme that does not say otherwise presses with a tonal overlay, not a sink.
  const press =
    file.motion?.press ??
    (engine === "flat" && baseMaterial.engine !== "flat"
      ? "overlay"
      : base.motion.press);
  const durationScale = file.motion?.durationScale ?? 1;
  const motion: MotionSpec = {
    ...base.motion,
    duration: {
      fast: Math.round(base.motion.duration.fast * durationScale),
      base: Math.round(base.motion.duration.base * durationScale),
      slow: Math.round(base.motion.duration.slow * durationScale),
    },
    press,
    pressScale:
      file.motion?.pressScale ??
      (press === "scale" && base.motion.pressScale >= 1
        ? 0.97
        : base.motion.pressScale),
    pressTranslate:
      file.motion?.pressTranslate ??
      (press === "translate" && base.motion.pressTranslate < 1
        ? 2
        : base.motion.pressTranslate),
  };
  if (press === "translate" && motion.pressTranslate < 1)
    errors.push(
      'motion.pressTranslate: must be at least 1 when motion.press is "translate"',
    );
  if (press === "scale" && motion.pressScale >= 1)
    errors.push(
      'motion.pressScale: must be below 1 when motion.press is "scale"',
    );

  // Every face without Hebrew gets Rubik as a fallback so Hebrew always has a glyph source.
  const scale = { ...base.type.scale } as TypeScaleSpec;
  for (const variant of TYPE_VARIANTS) {
    const override = file.type?.scale?.[variant];
    if (!override) continue;
    const merged = pickDefined(scale[variant], override);
    if (merged.lineHeight < merged.fontSize)
      errors.push(
        `type.scale.${variant}.lineHeight: must be at least type.scale.${variant}.fontSize`,
      );
    scale[variant] = merged;
  }
  const type = {
    text: file.type?.text ? stackFor(file.type.text.family) : base.type.text,
    numeric: file.type?.numeric
      ? stackFor(file.type.numeric.family)
      : base.type.numeric,
    scale,
  };

  const lineWidth = file.charts?.lineWidth;
  const toneMix = file.charts?.tone?.containerMix;
  const charts: ChartSpec = {
    ...base.charts,
    ...(toneMix
      ? {
          tone: {
            ...base.charts.tone,
            containerMix: {
              light: toneMix.light ?? base.charts.tone.containerMix.light,
              dark: toneMix.dark ?? base.charts.tone.containerMix.dark,
            },
          },
        }
      : {}),
    ...(lineWidth !== undefined
      ? { lineWidth, sparklineWidth: Math.max(1, lineWidth - 0.5) }
      : {}),
    ...(file.charts?.donutThickness !== undefined
      ? { donutThickness: file.charts.donutThickness }
      : {}),
    ...(file.charts?.gridDash !== undefined
      ? { gridDash: file.charts.gridDash }
      : {}),
    ...(file.charts?.lineCap !== undefined
      ? { lineCap: file.charts.lineCap }
      : {}),
    ...(file.charts?.patterns !== undefined
      ? { patterns: file.charts.patterns }
      : {}),
    ...(file.charts?.categoryPalette !== undefined
      ? { categoryPalette: [...file.charts.categoryPalette] }
      : {}),
  };

  const accent = {
    // A theme inheriting a system accent from its base only keeps it when the file asks (version 2).
    mode:
      file.accent?.mode ??
      (base.accent.mode === "system" ? "user" : base.accent.mode),
    default: file.accent?.default ?? base.accent.default,
    presets: file.accent?.presets
      ? [...file.accent.presets]
      : [...base.accent.presets],
  } as ThemeDefinition["accent"];

  const theme: ThemeDefinition = {
    id: file.id,
    name: file.name.trim(),
    palette,
    shadows: {
      light: deriveShadows("light", palette.light, base, engine, bevelDepth),
      dark: deriveShadows("dark", palette.dark, base, engine, bevelDepth),
    },
    space,
    radius,
    tile,
    iconSize: base.iconSize,
    motion,
    material,
    type,
    icons: {
      ...base.icons,
      ...(file.icons?.set ? { set: file.icons.set } : {}),
      ...(file.icons?.categorySet
        ? { categorySet: file.icons.categorySet }
        : {}),
      ...(file.icons?.badge ? { badge: file.icons.badge } : {}),
      ...(file.icons?.badgeShape ? { badgeShape: file.icons.badgeShape } : {}),
    },
    charts,
    accent,
  };
  return { theme, warnings, errors };
}

/**
 * Validates and resolves a custom theme file. Never throws.
 *
 * `file` in the result is the author's validated file (a JSON-clean, canonically ordered copy):
 * export and storage use it, so the contrast warnings never rewrite what the author wrote.
 */
export function parseCustomTheme(input: unknown): CustomThemeParseResult {
  try {
    let json: string | undefined;
    try {
      json = JSON.stringify(input);
    } catch {
      return { ok: false, errors: ["$: must be plain JSON data"] };
    }
    if (json === undefined)
      return { ok: false, errors: ["$: must be a JSON object"] };
    if (json.length > MAX_CUSTOM_THEME_BYTES) {
      return {
        ok: false,
        errors: [
          `$: theme file is too large (${json.length} characters; the limit is ${MAX_CUSTOM_THEME_BYTES})`,
        ],
      };
    }
    // Validate the JSON-clean clone, so what is checked is exactly what gets stored.
    const clone: unknown = JSON.parse(json);

    const errors: Errors = [];
    scanForDangerousStrings(clone, "$", errors);
    const read = readFile(clone, errors);
    if (!read || errors.length > 0)
      return { ok: false, errors: dedupe(errors) };

    const file = canonicalizeCustomThemeFile(read);
    const base = BUILT_IN_THEMES.find(
      (theme) => theme.id === (file.extends ?? "classic"),
    );
    if (!base)
      return { ok: false, errors: ["extends: must be a built-in theme id"] };

    const built = buildTheme(file, base);
    if (built.errors.length > 0)
      return { ok: false, errors: dedupe(built.errors) };
    try {
      assertThemeDefinition(built.theme);
    } catch (error) {
      return {
        ok: false,
        errors: [
          error instanceof Error
            ? error.message
            : "The theme failed validation.",
        ],
      };
    }
    return { ok: true, file, theme: built.theme, warnings: built.warnings };
  } catch {
    // Defensive: parsing user input must never crash the caller.
    return { ok: false, errors: ["$: the theme could not be read"] };
  }
}

const dedupe = (errors: string[]) => [...new Set(errors)];

// ---- serialization ----

function ordered<T extends object>(
  source: T | undefined,
  keys: readonly (keyof T)[],
): T | undefined {
  if (!source) return undefined;
  const out = {} as T;
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Rebuilds a validated file with a stable key order (the order of this schema). */
export function canonicalizeCustomThemeFile(
  file: CustomThemeFile,
): CustomThemeFile {
  const out: CustomThemeFile = {
    themeSchemaVersion: file.themeSchemaVersion,
    id: file.id,
    name: file.name,
    ...(file.extends !== undefined ? { extends: file.extends } : {}),
    palette: {
      light: ordered(file.palette.light, PALETTE_KEYS) ?? {},
      dark: ordered(file.palette.dark, PALETTE_KEYS) ?? {},
    },
  };
  return finishCanonical(out, file);
}

function finishCanonical(
  out: CustomThemeFile,
  file: CustomThemeFile,
): CustomThemeFile {
  if (file.accent)
    out.accent = ordered(file.accent, ["mode", "default", "presets"]);
  if (file.shape) {
    out.shape = {};
    if (file.shape.radius)
      out.shape.radius = ordered(file.shape.radius, [
        "sm",
        "control",
        "tile",
        "card",
        "sheet",
        "nav",
        "fab",
        "pill",
      ]);
    if (file.shape.space)
      out.shape.space = ordered(file.shape.space, SPACE_KEYS);
    if (file.shape.tile)
      out.shape.tile = ordered(file.shape.tile, [
        "size",
        "icon",
        "compactSize",
        "compactIcon",
      ]);
  }
  if (file.material)
    out.material = ordered(file.material, [
      "engine",
      "card",
      "gradients",
      "bevelDepth",
    ]);
  if (file.motion)
    out.motion = ordered(file.motion, [
      "press",
      "pressScale",
      "pressTranslate",
      "durationScale",
    ]);
  if (file.type) {
    out.type = {};
    if (file.type.text) out.type.text = { family: file.type.text.family };
    if (file.type.numeric)
      out.type.numeric = { family: file.type.numeric.family };
    if (file.type.scale) {
      const scale: CustomTypeScale = {};
      for (const variant of TYPE_VARIANTS) {
        const entry = file.type.scale[variant];
        if (entry)
          scale[variant] = ordered(entry, [
            "fontSize",
            "lineHeight",
            "weight",
            "letterSpacing",
          ]);
      }
      out.type.scale = scale;
    }
  }
  if (file.icons)
    out.icons = ordered(file.icons, [
      "set",
      "categorySet",
      "badge",
      "badgeShape",
    ]);
  if (file.charts) {
    out.charts = ordered(file.charts, [
      "patterns",
      "lineWidth",
      "donutThickness",
      "gridDash",
      "lineCap",
      "categoryPalette",
      "tone",
    ]);
    if (file.charts.tone?.containerMix && out.charts)
      out.charts.tone = {
        containerMix: ordered(file.charts.tone.containerMix, ["light", "dark"]),
      };
  }
  return out;
}

/** The author's file as a plain object with stable key order. This is what the store persists. */
export const serializeCustomTheme = canonicalizeCustomThemeFile;

/** Pretty-printed (2 spaces), stable key order. Round-trips through `parseCustomTheme`. */
export function exportCustomThemeJson(file: CustomThemeFile): string {
  return `${JSON.stringify(canonicalizeCustomThemeFile(file), null, 2)}\n`;
}
