export const QASHY_INDIGO = '#5966E9';

export const ACCENT_PRESETS = [
  '#5966E9',
  '#007AFF',
  '#00A58E',
  '#36A852',
  '#E7892C',
  '#E0516B',
  '#A95BCD',
  '#6D7885',
] as const;

/** Human names for the accent presets, used as swatch accessibility labels. */
export const ACCENT_PRESET_NAMES: Record<(typeof ACCENT_PRESETS)[number], string> = {
  '#5966E9': 'Indigo',
  '#007AFF': 'Blue',
  '#00A58E': 'Teal',
  '#36A852': 'Green',
  '#E7892C': 'Orange',
  '#E0516B': 'Rose',
  '#A95BCD': 'Purple',
  '#6D7885': 'Slate',
};

/**
 * Softer, lower-chroma colors for categories. Categories appear many times per
 * screen, so they stay a notch quieter than the accent family; the starter
 * categories in `domain/defaults.ts` are drawn from this same set.
 */
export const CATEGORY_PALETTE = [
  '#5F9F78',
  '#E08C5A',
  '#5B8DEF',
  '#8B76D8',
  '#E16B75',
  '#C47ED0',
  '#4C9CB5',
  '#6D7885',
] as const;

/**
 * The spacing scale. Every gap, padding, and inset in the app comes from here.
 *
 * Before this existed the codebase used fifteen different gap values — 1, 2, 4,
 * 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22 — typed at the call site, so no two
 * screens breathed the same way and a card's internal rhythm depended on which
 * feature owned it. A 4pt scale (plus a 2pt hairline step for text stacks) is
 * coarse enough that neighbouring values read as deliberate steps rather than as
 * noise.
 */
export const space = {
  /** Between two lines that belong to the same thought (title over subtitle). */
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/**
 * Corner radii. The "soft & tactile" redesign widens every step so surfaces
 * read as continuous, materially rounded shapes rather than sharp-cornered
 * panels — a raised card or sheet should look poured, not cut. Key names are
 * unchanged so every call site keeps working; only the values grew.
 */
export const radius = {
  sm: 10,
  control: 14,
  /** Icon tiles, swatches, and other small filled squares. */
  tile: 14,
  card: 22,
  /** Floating overlays: the update prompt, the reload banner. */
  sheet: 28,
  /** Navigation items: rail buttons, sidebar rows, the bottom-bar indicator. */
  nav: 16,
  pill: 999,
} as const;

/**
 * Shared timing and spring presets for the soft/tactile motion language:
 * raised controls settle with a snappy spring, larger surfaces (sheets,
 * cards reflowing) use a gentler one, and emphasis moments (a completed
 * goal, a saved form) get a touch more energy. `pressScale` is how far a
 * raised control visibly sinks — scale, not just a shadow swap — when
 * pressed, to sell the "it's physically depressing" feel.
 */
export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  spring: {
    snappy: { damping: 22, stiffness: 320, mass: 0.8 },
    gentle: { damping: 20, stiffness: 180, mass: 1 },
    emphasized: { damping: 16, stiffness: 220, mass: 1 },
  },
  /** How far a raised control sinks when pressed. */
  pressScale: 0.97,
} as const;

/**
 * One size for every tinted icon tile (account, category, settings row, budget,
 * goal). Before this there were 38pt and 44pt tiles with 17, 18, 20 and 21pt
 * glyphs, so the same category looked like a different object on each screen.
 */
export const tile = {
  size: 40,
  icon: 20,
  /** Dense lists: compact transaction rows, chips. */
  compactSize: 32,
  compactIcon: 16,
} as const;

/** Glyph sizes for standalone icons (buttons, empty states, inline markers). */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

/**
 * Rubik, bundled with the app. It covers Latin and Hebrew (the two shipped
 * locales) in one family and carries a real `tnum` feature, so ledger figures
 * line up in both scripts without a second numeric face.
 *
 * React Native cannot pick a static font file from `fontWeight` on Android,
 * so each weight is its own family and `fontFamilyFor` maps a weight to it.
 */
export const fontFamilies = {
  regular: 'Rubik_400Regular',
  medium: 'Rubik_500Medium',
  semibold: 'Rubik_600SemiBold',
  bold: 'Rubik_700Bold',
} as const;

export type FontWeightName = keyof typeof fontFamilies;

/**
 * Space Grotesk, used only as a numeric display face for money figures and
 * hero numbers (`typeScale.hero`, `display`, `money`, `figure`). Rubik still
 * renders every word — including Hebrew, which Space Grotesk does not cover —
 * so this face is scoped to variants whose content is guaranteed to be
 * digits. Digits are script-agnostic, so swapping their face never affects
 * Hebrew layout or shaping. There is no bundled 400-weight file, so
 * `numericFontStyle('regular')` falls back to `medium`.
 */
export const numericFontFamilies = {
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
} as const;

/**
 * The type scale. Sizes step by at least ~25% at the top of the ramp so the
 * hero figure, a screen title, an inline amount and a section heading never
 * read as near-misses of each other (they used to be 34 / 30 / 28 / 20).
 *
 * `hero` sits above `display` for the single largest figure in the redesign
 * (the net-worth number); `figure` is a smaller numeric stat (e.g. income or
 * spent) that sits under a hero without competing with `label`/`headline`.
 */
export const typeScale = {
  /** The single largest figure in the app: the net-worth hero number. */
  hero: { fontSize: 48, lineHeight: 54, weight: 'semibold', letterSpacing: -1.6 },
  /** The single largest figure on a screen. Net worth, a month's net flow. */
  display: { fontSize: 40, lineHeight: 46, weight: 'semibold', letterSpacing: -1.2 },
  title: { fontSize: 28, lineHeight: 34, weight: 'semibold', letterSpacing: -0.6 },
  /** A prominent amount inside a section: a budget's spend, a goal total. */
  money: { fontSize: 22, lineHeight: 28, weight: 'semibold', letterSpacing: -0.4 },
  headline: { fontSize: 18, lineHeight: 24, weight: 'semibold', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22, weight: 'regular', letterSpacing: 0 },
  /** A short piece of UI text with weight: a row title, a button, a stat value. */
  label: { fontSize: 15, lineHeight: 20, weight: 'medium', letterSpacing: -0.1 },
  /** A numeric stat value under a hero figure (e.g. income/spent this period). */
  figure: { fontSize: 18, lineHeight: 24, weight: 'semibold', letterSpacing: -0.3 },
  caption: { fontSize: 13, lineHeight: 18, weight: 'regular', letterSpacing: 0 },
  /** A sentence-case kicker above a heading, a hero figure or a group of rows. */
  overline: { fontSize: 13, lineHeight: 18, weight: 'medium', letterSpacing: 0 },
  /** Tiny all-caps status text inside a pill ("UPCOMING"). Not for headings. */
  eyebrow: { fontSize: 11, lineHeight: 14, weight: 'semibold', letterSpacing: 0.6 },
} as const satisfies Record<string, { fontSize: number; lineHeight: number; weight: FontWeightName; letterSpacing: number }>;

/** Variants that always render in the numeric display face (Space Grotesk). */
export const NUMERIC_FACE_VARIANTS = ['hero', 'display', 'money', 'figure'] as const;

export interface BaseTokens {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  /** The fill of a sunken "well": progress tracks, segmented-control tracks, input fields. */
  surfaceSunken: string;
  text: string;
  textMuted: string;
  border: string;
  positive: string;
  negative: string;
  warning: string;
  /** Semantic color for transfers — neither income nor expense. */
  transfer: string;
}

/**
 * Light surfaces.
 *
 * Cards are borderless and shadowless at rest, so the page/surface step is
 * the only thing separating a section from the page. `#F6F7F9` against white
 * was too faint to carry that on its own; `#F1F2F5` is the lightest page tone
 * that still reads as a distinct plane on a typical laptop panel.
 *
 * `surfaceElevated` stays white — it is the top of the light ramp — and
 * floating layers (sheets, menus) add `shadowOverlay` instead.
 *
 * `background` is asserted by the web e2e suite as the address-bar theme color.
 */
export const lightTokens: BaseTokens = {
  background: '#F1F2F5',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#E9EBEF',
  surfaceSunken: '#E8EAEE',
  text: '#191B20',
  textMuted: '#5F6570',
  border: '#E3E5EA',
  positive: '#208653',
  negative: '#C43D4A',
  warning: '#9A6700',
  transfer: '#3F6FD8',
};

/**
 * Dark surfaces.
 *
 * The ramp used to span `#0E0F13 → #16171C → #1D1F26 → #23252C`, which put only
 * a few luminance steps between a card and an "elevated" card. Shadows are
 * effectively invisible against a dark page, so with the ramp that tight nothing
 * conveyed depth at all and every surface read as one flat plane. Widening it
 * gives each tier a visible step, which is how elevation has to work here.
 */
export const darkTokens: BaseTokens = {
  background: '#0C0D11',
  surface: '#15161B',
  surfaceElevated: '#1E2027',
  surfaceMuted: '#262931',
  surfaceSunken: '#0F1014',
  text: '#F2F3F5',
  textMuted: '#9BA1AC',
  border: '#2E323B',
  positive: '#65D99A',
  negative: '#FF8F96',
  warning: '#F0C36A',
  transfer: '#8FB0FF',
};

function channels(hex: string): [number, number, number] {
  let value = hex.replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const parsed = Number.parseInt(value.slice(0, 6), 16);
  if (!Number.isFinite(parsed)) return [0, 0, 0];
  return [(parsed >> 16) & 0xff, (parsed >> 8) & 0xff, parsed & 0xff];
}

function toHex(rgb: [number, number, number]) {
  return `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
}

export function relativeLuminance(hex: string) {
  const [r, g, b] = channels(hex).map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextColor(hex: string): '#FFFFFF' | '#000000' {
  return contrastRatio('#FFFFFF', hex) >= contrastRatio('#000000', hex) ? '#FFFFFF' : '#000000';
}

export function mixHex(from: string, to: string, weight: number) {
  const a = channels(from);
  const b = channels(to);
  const t = Math.min(1, Math.max(0, weight));
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Appends an alpha channel to a hex color, e.g. for a translucent press/ripple overlay. */
export function withAlpha(hex: string, alpha: number) {
  const clamped = Math.min(1, Math.max(0, alpha));
  return `${hex}${Math.round(clamped * 255).toString(16).padStart(2, '0')}`;
}

export function ensureContrast(
  foreground: string,
  background: string,
  fallback: string,
  minimum = 4.5,
) {
  if (contrastRatio(foreground, background) >= minimum) return foreground.toUpperCase();
  const safeFallback = contrastRatio(fallback, background) >= minimum
    ? fallback
    : readableTextColor(background);
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const midpoint = (low + high) / 2;
    if (contrastRatio(mixHex(foreground, safeFallback, midpoint), background) >= minimum) {
      high = midpoint;
    } else {
      low = midpoint;
    }
  }
  return mixHex(foreground, safeFallback, high).toUpperCase();
}

export function accessibleAccentColor(seed: string, surface: string, text: string) {
  return ensureContrast(seed, surface, text, 3);
}

export interface ToneColors {
  /** A tinted fill that stays a surface, not a shout. */
  container: string;
  /** A glyph or label color that clears 3:1 against `container`. */
  onContainer: string;
}

/**
 * Turns a user-chosen entity color (category, budget, goal) into a container +
 * on-container pair, the same way the theme derives `accentContainer`.
 *
 * Category colors used to be painted at full saturation across 44pt tiles, so a
 * transaction list with eight categories read as eight competing signal lights
 * and the amount — the thing a ledger is actually for — lost the fight. Tinting
 * the fill toward the surface keeps every category distinguishable at a glance
 * while leaving the strongest contrast in the row for the number.
 *
 * `surface` and `text` must be real hex. Under Android's Material You the theme
 * exposes opaque platform colors with no JS-readable value, which is what
 * `staticSurface`/`staticText` on ThemeTokens are for.
 */
export function toneColors(seed: string, surface: string, text: string, dark: boolean): ToneColors {
  const container = mixHex(seed, surface, dark ? 0.78 : 0.86);
  return { container, onContainer: ensureContrast(seed, container, text, 3) };
}
