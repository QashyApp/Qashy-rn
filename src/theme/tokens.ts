export const QASHY_INDIGO = "#5070FF";

export const ACCENT_PRESETS = [
  "#5070FF",
  "#007AFF",
  "#00A58E",
  "#36A852",
  "#E7892C",
  "#E0516B",
  "#A95BCD",
  "#6D7885",
] as const;

/** Human names for the accent presets, used as swatch accessibility labels. */
export const ACCENT_PRESET_NAMES: Record<
  (typeof ACCENT_PRESETS)[number],
  string
> = {
  "#5070FF": "Indigo",
  "#007AFF": "Blue",
  "#00A58E": "Teal",
  "#36A852": "Green",
  "#E7892C": "Orange",
  "#E0516B": "Rose",
  "#A95BCD": "Purple",
  "#6D7885": "Slate",
};

/**
 * Softer, lower-chroma colors for categories. Categories appear many times per
 * screen, so they stay a notch quieter than the accent family; the starter
 * categories in `domain/defaults.ts` are drawn from this same set.
 */
export const CATEGORY_PALETTE = [
  "#5F9F78",
  "#E08C5A",
  "#5B8DEF",
  "#8B76D8",
  "#E16B75",
  "#C47ED0",
  "#4C9CB5",
  "#6D7885",
] as const;

/**
 * The spacing scale. Every gap, padding, and inset in the app comes from here.
 *
 * No call site types its own gap value. Why: fifteen ad hoc values (1, 2, 4, 5, 6, 7, 8, 9,
 * 10, 12, 14, 16, 18, 20, 22) meant no two screens breathed the same way and a card's
 * internal rhythm depended on which feature owned it. A 4pt scale (plus a 2pt hairline step for text stacks) is
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
 * Corner radii — the Dew shape language. Corners are wide and continuous so a
 * card, sheet or control reads as one poured solid rather than a panel with
 * rounding applied to it. Key names are unchanged so every call site keeps
 * working; the floating action button is now a rounded square (`fab`) rather
 * than the old full pill, and `pill` still marks the shapes that stay fully
 * round.
 */
export const radius = {
  sm: 12,
  control: 18,
  /** Icon tiles, swatches, and other small filled squares. */
  tile: 18,
  card: 28,
  /** Floating overlays: the update prompt, the reload banner. */
  sheet: 34,
  /** Navigation items: rail buttons, sidebar rows, the bottom-bar indicator. */
  nav: 20,
  /** The floating action button: a rounded square. */
  fab: 22,
  pill: 999,
} as const;

/**
 * Shared timing and spring presets for the Dew motion language: raised
 * controls settle with a snappy spring, larger surfaces (sheets, cards
 * reflowing) use a gentler one, and emphasis moments (a completed goal, a
 * saved form) get a touch more energy. Durations run quicker than the old
 * soft language — Dew answers a touch almost immediately — and `pressScale`
 * is how far a raised control visibly sinks when pressed, to sell the
 * "it's physically depressing" feel.
 */
export const motion = {
  duration: { fast: 100, base: 160, slow: 280 },
  spring: {
    snappy: { damping: 20, stiffness: 420, mass: 0.72 },
    gentle: { damping: 19, stiffness: 200, mass: 1 },
    emphasized: { damping: 15, stiffness: 250, mass: 1 },
  },
  /** How far a raised control sinks when pressed. */
  pressScale: 0.97,
  /** `scale` sinks a control by shrinking it; `translate` shifts it down `pressTranslate` px (pixel-style themes). */
  press: "scale" as "scale" | "translate",
  pressTranslate: 0,
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
  regular: "Rubik_400Regular",
  medium: "Rubik_500Medium",
  semibold: "Rubik_600SemiBold",
  bold: "Rubik_700Bold",
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
  medium: "SpaceGrotesk_500Medium",
  semibold: "SpaceGrotesk_600SemiBold",
  bold: "SpaceGrotesk_700Bold",
} as const;

/**
 * The type scale. Sizes step by at least ~25% at the top of the ramp so the
 * hero figure, a screen title, an inline amount and a section heading never
 * read as near-misses of each other (a 34 / 30 / 28 / 20 ramp was too tight).
 *
 * `hero` sits above `display` for the single largest figure in the redesign
 * (the net-worth number); `figure` is a smaller numeric stat (e.g. income or
 * spent) that sits under a hero without competing with `label`/`headline`.
 */
export const typeScale = {
  /** The single largest figure in the app: the net-worth hero number. */
  hero: {
    fontSize: 48,
    lineHeight: 54,
    weight: "semibold",
    letterSpacing: -1.6,
  },
  /** The single largest figure on a screen. Net worth, a month's net flow. */
  display: {
    fontSize: 40,
    lineHeight: 46,
    weight: "semibold",
    letterSpacing: -1.2,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    weight: "semibold",
    letterSpacing: -0.6,
  },
  /** A prominent amount inside a section: a budget's spend, a goal total. */
  money: {
    fontSize: 22,
    lineHeight: 28,
    weight: "semibold",
    letterSpacing: -0.4,
  },
  headline: {
    fontSize: 18,
    lineHeight: 24,
    weight: "semibold",
    letterSpacing: -0.2,
  },
  body: { fontSize: 16, lineHeight: 22, weight: "regular", letterSpacing: 0 },
  /** A short piece of UI text with weight: a row title, a button, a stat value. */
  label: {
    fontSize: 15,
    lineHeight: 20,
    weight: "medium",
    letterSpacing: -0.1,
  },
  /** A numeric stat value under a hero figure (e.g. income/spent this period). */
  figure: {
    fontSize: 18,
    lineHeight: 24,
    weight: "semibold",
    letterSpacing: -0.3,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    weight: "regular",
    letterSpacing: 0,
  },
  /** A sentence-case kicker above a heading, a hero figure or a group of rows. */
  overline: {
    fontSize: 13,
    lineHeight: 18,
    weight: "medium",
    letterSpacing: 0,
  },
  /** Tiny all-caps status text inside a pill ("UPCOMING"). Not for headings. */
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    weight: "semibold",
    letterSpacing: 0.6,
  },
} as const satisfies Record<
  string,
  {
    fontSize: number;
    lineHeight: number;
    weight: FontWeightName;
    letterSpacing: number;
  }
>;

/** Variants that always render in the theme's numeric display face. */
export const NUMERIC_FACE_VARIANTS = [
  "hero",
  "display",
  "money",
  "figure",
] as const;

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
  /** Material 3 secondary container: quiet tonal fills (chips, selected rows, inactive tracks). */
  secondaryContainer: string;
  onSecondaryContainer: string;
  /** Material 3 tertiary container: a second accent family to set against the primary. */
  tertiaryContainer: string;
  onTertiaryContainer: string;
  /** The native stack header fill. Equals `background` in themes whose header is invisible. */
  headerBackground: string;
  /** The tab / navigation bar fill. */
  navBackground: string;
}

export const ROLE_TOKEN_KEYS = [
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiaryContainer",
  "onTertiaryContainer",
  "headerBackground",
  "navBackground",
] as const;

/**
 * Light surfaces — the Dew palette.
 *
 * A violet-leaning neutral cage: the page is a soft lilac, cards carry a hint
 * of the same hue, and wells sit a step below the page. Each tier is a
 * visible tonal step, which is what lets cards keep only a whisper of
 * elevation (see `classic.ts`). `surfaceElevated` stays white — it is the top
 * of the light ramp — and floating layers add `shadowOverlay` instead.
 *
 * `background` is asserted by the web e2e suite as the address-bar theme color.
 */
export const lightTokens: BaseTokens = {
  background: "#E8E7F8",
  surface: "#FBFBFF",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#E0DFF4",
  surfaceSunken: "#DBDBF2",
  text: "#191B20",
  textMuted: "#575D67",
  border: "#D7D8EF",
  positive: "#208653",
  negative: "#C43D4A",
  warning: "#9A6700",
  transfer: "#3F6FD8",
  secondaryContainer: "#E0DFF4",
  onSecondaryContainer: "#191B20",
  tertiaryContainer: "#E1E1FA",
  onTertiaryContainer: "#4340B8",
  headerBackground: "#E8E7F8",
  navBackground: "#FBFBFF",
};

/**
 * Dark surfaces — the Dew palette.
 *
 * A violet-leaning ramp: the page is a deep indigo-black and every raised
 * tier steps up from it (`#151524 → #1C1C2E → #242537`). Shadows are
 * effectively invisible against a dark page, so with a tight ramp nothing
 * would convey depth at all and every surface would read as one flat plane;
 * a visible luminance step per tier is how elevation has to work here.
 */
export const darkTokens: BaseTokens = {
  background: "#121221",
  surface: "#1C1C2E",
  surfaceElevated: "#242537",
  surfaceMuted: "#2C2D44",
  surfaceSunken: "#151524",
  text: "#F2F3F5",
  textMuted: "#9BA1AC",
  border: "#33354E",
  positive: "#65D99A",
  negative: "#FF8F96",
  warning: "#F0C36A",
  transfer: "#8FB0FF",
  secondaryContainer: "#2C2D44",
  onSecondaryContainer: "#F2F3F5",
  tertiaryContainer: "#2A2B4A",
  onTertiaryContainer: "#A9B6FF",
  headerBackground: "#121221",
  navBackground: "#242537",
};

function channels(hex: string): [number, number, number] {
  let value = hex.replace("#", "");
  if (value.length === 3)
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  const parsed = Number.parseInt(value.slice(0, 6), 16);
  if (!Number.isFinite(parsed)) return [0, 0, 0];
  return [(parsed >> 16) & 0xff, (parsed >> 8) & 0xff, parsed & 0xff];
}

function toHex(rgb: [number, number, number]) {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function relativeLuminance(hex: string) {
  const [r, g, b] = channels(hex).map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.04045
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextColor(hex: string): "#FFFFFF" | "#000000" {
  return contrastRatio("#FFFFFF", hex) >= contrastRatio("#000000", hex)
    ? "#FFFFFF"
    : "#000000";
}

export function mixHex(from: string, to: string, weight: number) {
  const a = channels(from);
  const b = channels(to);
  const t = Math.min(1, Math.max(0, weight));
  return toHex([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

/** Appends an alpha channel to a hex color, e.g. for a translucent press/ripple overlay. */
export function withAlpha(hex: string, alpha: number) {
  const clamped = Math.min(1, Math.max(0, alpha));
  return `${hex}${Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export function ensureContrast(
  foreground: string,
  background: string,
  fallback: string,
  minimum = 4.5,
) {
  if (contrastRatio(foreground, background) >= minimum)
    return foreground.toUpperCase();
  const safeFallback =
    contrastRatio(fallback, background) >= minimum
      ? fallback
      : readableTextColor(background);
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const midpoint = (low + high) / 2;
    if (
      contrastRatio(mixHex(foreground, safeFallback, midpoint), background) >=
      minimum
    ) {
      high = midpoint;
    } else {
      low = midpoint;
    }
  }
  return mixHex(foreground, safeFallback, high).toUpperCase();
}

export function accessibleAccentColor(
  seed: string,
  surface: string,
  text: string,
) {
  return ensureContrast(seed, surface, text, 3);
}

/** How a stored entity color becomes a container tint; a theme's `charts.tone`. */
export interface ToneSpec {
  containerMix: { light: number; dark: number };
  minContrast: number;
}

/** The shipped tint recipe, used when a caller passes no theme tone. */
export const CLASSIC_TONE: ToneSpec = {
  containerMix: { light: 0.86, dark: 0.78 },
  minContrast: 3,
};

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
 * The fill is tinted toward the surface rather than painted at full saturation. Why: full
 * saturation across 44pt tiles made a transaction list with eight categories read as eight
 * competing signal lights, and the amount — the thing a ledger is actually for — lost the
 * fight. Tinting keeps every category distinguishable at a glance
 * while leaving the strongest contrast in the row for the number.
 *
 * `surface` and `text` must be real hex. Under Android's Material You the theme
 * exposes opaque platform colors with no JS-readable value, which is what
 * `staticSurface`/`staticText` on ThemeTokens are for.
 */
// Each entity badge asks for its tint on every render, and `ensureContrast` can bisect 18 times.
// The inputs are plain strings, so the result is cached per tone spec (bounded, then reset).
const TONE_CACHE = new WeakMap<ToneSpec, Map<string, ToneColors>>();
const TONE_CACHE_LIMIT = 500;

export function toneColors(
  seed: string,
  surface: string,
  text: string,
  dark: boolean,
  tone: ToneSpec = CLASSIC_TONE,
): ToneColors {
  let cache = TONE_CACHE.get(tone);
  if (!cache) {
    cache = new Map();
    TONE_CACHE.set(tone, cache);
  }
  const key = `${seed}|${surface}|${text}|${dark}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const container = mixHex(
    seed,
    surface,
    dark ? tone.containerMix.dark : tone.containerMix.light,
  );
  const colors: ToneColors = {
    container,
    onContainer: ensureContrast(seed, container, text, tone.minContrast),
  };
  if (cache.size >= TONE_CACHE_LIMIT) cache.clear();
  cache.set(key, colors);
  return colors;
}

/**
 * Derives the Material 3 style roles from colors a palette already defines. Used for custom
 * palettes that omit them and for themes seeded from the system tonal palettes. Pure.
 */
export function derivedRoleTokens(
  base: Pick<
    BaseTokens,
    | "background"
    | "surface"
    | "surfaceElevated"
    | "surfaceMuted"
    | "text"
    | "transfer"
  >,
  dark: boolean,
): Pick<BaseTokens, (typeof ROLE_TOKEN_KEYS)[number]> {
  const secondaryContainer = base.surfaceMuted;
  const tertiaryContainer = mixHex(
    base.transfer,
    base.surface,
    dark ? 0.75 : 0.84,
  );
  return {
    secondaryContainer,
    onSecondaryContainer: ensureContrast(
      base.text,
      secondaryContainer,
      base.text,
    ),
    tertiaryContainer,
    onTertiaryContainer: ensureContrast(
      base.transfer,
      tertiaryContainer,
      base.text,
    ),
    headerBackground: base.background,
    navBackground: base.surfaceElevated,
  };
}
