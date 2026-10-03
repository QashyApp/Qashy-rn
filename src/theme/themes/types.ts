import type { BaseTokens, FontWeightName, iconSize, radius, space, tile } from '@/theme/tokens';

export type ThemeScheme = 'light' | 'dark';

/** The elevation ladder and modal scrim for one scheme. Every value is a CSS `box-shadow`/color string. */
export interface ShadowSet {
  shadowCard: string;
  shadowRaised: string;
  shadowControl: string;
  shadowControlPressed: string;
  shadowSunken: string;
  shadowOverlay: string;
  shadowFab: string;
  scrim: string;
}

/** Same keys as the classic scales, so a component never has to ask whether a step exists. */
export type SpaceScale = { readonly [K in keyof typeof space]: number };
export type RadiusScale = { readonly [K in keyof typeof radius]: number };
export type TileScale = { readonly [K in keyof typeof tile]: number };
export type IconSizeScale = { readonly [K in keyof typeof iconSize]: number };

export interface SpringSpec {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
}

export interface MotionSpec {
  readonly duration: { readonly fast: number; readonly base: number; readonly slow: number };
  readonly spring: { readonly snappy: SpringSpec; readonly gentle: SpringSpec; readonly emphasized: SpringSpec };
  /** How far a raised control sinks when pressed. */
  readonly pressScale: number;
  /** `scale` shrinks a pressed control by `pressScale`; `translate` shifts it down `pressTranslate` px instead. */
  readonly press: 'scale' | 'translate';
  readonly pressTranslate: number;
}

/**
 * How surfaces are built. `soft` is the layered blur-shadow look; `bevel` is a hard-edged
 * (0px blur) pixel look derived by `bevelShadowSet`. The shadow strings themselves still live
 * in `ThemeDefinition.shadows`, so any theme can hand-write them; the engine only decides how
 * the accent material is derived and whether `gradients` are layered on top.
 */
export interface MaterialSpec {
  engine: 'soft' | 'bevel';
  /** Layer the subtle surface/accent gradients. Off for flat or pixel looks. */
  gradients: boolean;
  /** Bevel thickness in px, used by the accent material when `engine` is `bevel`. */
  bevelDepth: number;
}

/**
 * Which font a text role renders in. `family` is an id in the font registry (`src/theme/fonts.ts`).
 * `fallbacks` are further registry ids tried per glyph on web (a CSS font stack), so a Latin-only
 * display face can still render Hebrew by listing a face that covers it.
 */
export interface FontStackSpec {
  family: string;
  fallbacks: readonly string[];
}

export interface TypeStyleSpec {
  fontSize: number;
  lineHeight: number;
  weight: FontWeightName;
  letterSpacing: number;
}

/** Same variants as the classic `typeScale`. */
export type TypeScaleSpec = Record<'hero' | 'display' | 'title' | 'money' | 'headline' | 'body' | 'label' | 'figure' | 'caption' | 'overline' | 'eyebrow', TypeStyleSpec>;

export interface TypeSpec {
  /** Every word. Must cover every shipped locale (directly or through `fallbacks`). */
  text: FontStackSpec;
  /** Digits and money figures. May be the same stack as `text`. */
  numeric: FontStackSpec;
  scale: TypeScaleSpec;
}

/** Which glyph set draws `ion:` and legacy icon ids. `ionicons` is the default; `emoji:` ids ignore it. */
export interface IconSpec {
  /** An id in the icon-set registry (`src/theme/icon-sets.ts`). */
  set: string;
}

export interface ChartSpec {
  /** Stroke of trend lines and sparklines. */
  lineWidth: number;
  /** Stroke of the compact sparkline, which stays a touch lighter than the full chart. Defaults to `lineWidth` when omitted. */
  sparklineWidth?: number;
  lineCap: 'round' | 'butt' | 'square';
  /** Ring thickness of the donut. */
  donutThickness: number;
  /** SVG dash array for gridlines; empty string = solid. */
  gridDash: string;
  /** Distinguish series by hatch/dot pattern as well as color. */
  patterns: boolean;
  /** Suggested colors for NEW categories and accounts. Stored colors are never rewritten. */
  categoryPalette: readonly string[];
  /** How a stored entity color becomes a container tint at render time. */
  tone: { containerMix: { light: number; dark: number }; minContrast: number };
}

/**
 * One complete visual identity.
 *
 * Both schemes are mandatory: a theme that only described light mode would leave dark mode
 * (or a user following the system) to invent colors, so `palette` and `shadows` are keyed by
 * both and `assertThemeDefinition` rejects a theme missing either.
 *
 * This is the Phase 1 surface of `docs/theming-plan.md`. Later phases add shape, spacing,
 * material recipes, typography, motion, icons and charts to this same object.
 */
export interface ThemeDefinition {
  /** Stable, lowercase, hyphenated. Stored per device in `AppSettings.themeId`; never reused for another look. */
  id: string;
  /** Display name. */
  name: string;
  palette: Record<ThemeScheme, BaseTokens>;
  shadows: Record<ThemeScheme, ShadowSet>;
  /** Shape and rhythm. Scheme-independent: a theme's corners do not change with dark mode. */
  space: SpaceScale;
  radius: RadiusScale;
  tile: TileScale;
  iconSize: IconSizeScale;
  motion: MotionSpec;
  material: MaterialSpec;
  type: TypeSpec;
  icons: IconSpec;
  charts: ChartSpec;
  /** Platforms the theme is offered on; omitted = everywhere. `getTheme` falls back to classic elsewhere. */
  availableOn?: readonly ('ios' | 'android' | 'web')[];
  accent: {
    /**
     * `user`: the Appearance accent controls apply. `fixed`: the theme owns its accent and the
     * controls are hidden. `system`: the platform's dynamic accent (Android Material You) is used
     * where it exists, and `default` everywhere else; the controls are hidden.
     */
    mode: 'user' | 'fixed' | 'system';
    /** The accent used when the user has not chosen one, and the fallback off Android for the system source. */
    default: string;
    /** Curated swatches offered on the Appearance screen. */
    presets: readonly string[];
  };
}

export const DEFAULT_THEME_ID = 'classic';

/** Format only: whether an id resolves to a theme on *this* device is the registry's concern. */
export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function isValidThemeId(id: unknown): id is string {
  return typeof id === 'string' && THEME_ID_PATTERN.test(id);
}
