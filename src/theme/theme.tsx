import { Host } from '@expo/ui';
import { Color, DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { createContext, use, useEffect, useMemo, type ReactNode } from 'react';
import {
  Appearance,
  Platform,
  type ColorValue,
  useColorScheme,
} from 'react-native';

import { DirectionScope } from '@/components/ui/direction-scope';
import type { AccentSource } from '@/domain/models';
import { useLocalization } from '@/localization/localization';
import { useFinanceState } from '@/providers/finance-provider';
import { useCustomThemes } from '@/theme/custom/use-custom-themes';
import { bevelAccentShadow } from '@/theme/shadow';
import { classicTheme } from '@/theme/themes/classic';
import { getTheme } from '@/theme/themes/registry';
import type { ChartSpec, IconSizeScale, MaterialSpec, MotionSpec, RadiusScale, SpaceScale, ThemeDefinition, TileScale, TypeSpec } from '@/theme/themes/types';
import { fontStyle } from '@/theme/typography';
import {
  accessibleAccentColor,
  ensureContrast,
  mixHex,
  readableTextColor,
  withAlpha,
} from '@/theme/tokens';

export interface ThemeTokens {
  mode: 'light' | 'dark';
  /** Shape and rhythm come from the active theme; never import the classic constants from `@/theme/tokens`. */
  space: SpaceScale;
  radius: RadiusScale;
  tile: TileScale;
  iconSize: IconSizeScale;
  motion: MotionSpec;
  /** Registered icon set id (see `@/theme/icon-sets`); only changes how an icon id is drawn. */
  iconSet: string;
  /** Font stacks and the type scale; resolve faces with `fontStyle(weight, type)` and friends from `@/theme/typography`. */
  type: TypeSpec;
  /** Line/donut/grid geometry, slice patterns and category tone for charts. */
  charts: ChartSpec;
  /** Whether surfaces layer the subtle gradients (off for flat and pixel looks). */
  gradients: boolean;
  accent: ColorValue;
  /**
   * The accent as a *text or glyph* colour on the theme's own surfaces. `accent` itself only
   * clears 3:1 (it is mostly a fill), which is not enough for small text; this is nudged to 4.5:1
   * against background, surface and muted surface. Use it for any accent-coloured text.
   */
  accentText: ColorValue;
  onAccent: ColorValue;
  accentContainer: ColorValue;
  onAccentContainer: ColorValue;
  background: ColorValue;
  surface: ColorValue;
  surfaceElevated: ColorValue;
  surfaceMuted: ColorValue;
  /** The fill of a sunken "well": progress tracks, segmented-control tracks, input fields. */
  surfaceSunken: ColorValue;
  text: ColorValue;
  textMuted: ColorValue;
  border: ColorValue;
  positive: ColorValue;
  onPositive: ColorValue;
  negative: ColorValue;
  onNegative: ColorValue;
  warning: ColorValue;
  onWarning: ColorValue;
  /** Semantic color for transfers — neither an income nor an expense. */
  transfer: ColorValue;
  glassTint: 'light' | 'dark' | 'systemMaterial';
  staticAccent: string;
  /**
   * Real hex for the current mode's card surface and primary text.
   *
   * `surface` and `text` can be opaque Android platform colors under Material
   * You, which the hex helpers in `@/theme/tokens` cannot read. Anything doing
   * color math — `toneColors` for category tints, chart fills — must use these.
   */
  staticSurface: string;
  staticText: string;
  /**
   * CSS `linear-gradient(180deg, top, bottom)` for a raised surface (card,
   * sheet): a subtle top-to-bottom lightening that makes it read as physical
   * material rather than a flat fill. `undefined` under Android's Material You,
   * because `surface` is then an opaque platform color with no JS-readable hex
   * to gradient from.
   */
  surfaceGradient: string | undefined;
  /** CSS `linear-gradient(180deg, top, bottom)` for a primary/accent-filled control. */
  accentGradient: string;
  /**
   * The elevation ladder for the "soft & tactile" material language. Every
   * value is a real CSS `box-shadow` string, valid on native (RN 0.86's
   * `boxShadow` style prop) and on web. Raised surfaces (`shadowCard`,
   * `shadowRaised`) combine an inset top highlight — light catching the top
   * edge — with a soft, layered outer drop shadow, in both modes: unlike the
   * old ladder, dark mode's inset highlight *is* visible against a dark page
   * even though an outer glow would not be, so `shadowCard` is a real string
   * in both modes now, never `undefined`. Sunken wells and pressed controls
   * use an inset shadow only, with no outer shadow, so they read as carved in
   * rather than lifted.
   */
  shadowCard: string;
  shadowRaised: string;
  /** A raised, unpressed control (button, chip, input) at rest. */
  shadowControl: string;
  /** The same control pressed in: inset only, no outer shadow. */
  shadowControlPressed: string;
  /** A sunken well: progress track, segmented-control track, input field. */
  shadowSunken: string;
  shadowOverlay: string;
  /** The floating action button: tighter and darker than `shadowRaised`, so it reads as pressable. */
  shadowFab: string;
  /** An accent-filled control (primary button, FAB) at rest. */
  shadowAccent: string;
  /** The dimmed layer behind a modal picker or menu. */
  scrim: string;
}

const ThemeContext = createContext<ThemeTokens | null>(null);

/** Builds the accent-dependent shadow/gradient pair that no static const can hold. */
function accentMaterial(accent: string, dark: boolean, material: MaterialSpec) {
  if (material.engine === 'bevel') {
    return { accentGradient: `linear-gradient(180deg, ${accent}, ${accent})`, shadowAccent: bevelAccentShadow(accent, material.bevelDepth) };
  }
  const gradientTop = mixHex(accent, '#FFFFFF', dark ? 0.10 : 0.14);
  const accentGradient = `linear-gradient(180deg, ${gradientTop}, ${accent})`;
  const highlightAlpha = dark ? 0.18 : 0.28;
  const outerAlpha1 = dark ? 0.42 : 0.30;
  const outerAlpha2 = dark ? 0.6 : 0.45;
  const shadowAccent = `inset 0 1px 0 rgba(255,255,255,${highlightAlpha}), 0 1px 2px ${withAlpha(accent, outerAlpha1)}, 0 6px 14px -4px ${withAlpha(accent, outerAlpha2)}`;
  return { accentGradient, shadowAccent };
}

// Hand-tuned neutral surfaces with a single accent family. The user's accent
// only drives accent/accentContainer colors; surfaces stay neutral so the app
// keeps a conventional, high-contrast look in both modes.
export function accentTokens(seed: string, dark: boolean, theme: ThemeDefinition = classicTheme): ThemeTokens {
  const scheme = dark ? 'dark' : 'light';
  const base = theme.palette[scheme];
  const accent = accessibleAccentColor(seed, base.surface, base.text);
  const accentContainer = mixHex(accent, base.surface, dark ? 0.78 : 0.86);
  const surfaceGradient = dark
    ? `linear-gradient(180deg, ${mixHex(base.surface, '#FFFFFF', 0.035)}, ${base.surface})`
    : `linear-gradient(180deg, #FFFFFF, ${mixHex('#FFFFFF', base.background, 0.35)})`;
  const { accentGradient, shadowAccent } = accentMaterial(accent, dark, theme.material);
  return {
    mode: dark ? 'dark' : 'light',
    space: theme.space,
    radius: theme.radius,
    tile: theme.tile,
    iconSize: theme.iconSize,
    motion: theme.motion,
    iconSet: theme.icons.set,
    type: theme.type,
    charts: theme.charts,
    gradients: theme.material.gradients,
    accent,
    accentText: [base.surface, base.background, base.surfaceMuted].reduce(
      (color, surface) => ensureContrast(color, surface, base.text, theme.id === 'high-contrast' ? 7 : 4.5),
      accent,
    ),
    onAccent: readableTextColor(accent),
    accentContainer,
    onAccentContainer: ensureContrast(accent, accentContainer, base.text),
    background: base.background,
    surface: base.surface,
    surfaceElevated: base.surfaceElevated,
    surfaceMuted: base.surfaceMuted,
    surfaceSunken: base.surfaceSunken,
    text: base.text,
    textMuted: base.textMuted,
    border: base.border,
    positive: base.positive,
    onPositive: readableTextColor(base.positive),
    negative: base.negative,
    onNegative: readableTextColor(base.negative),
    warning: base.warning,
    onWarning: readableTextColor(base.warning),
    transfer: base.transfer,
    glassTint: dark ? 'dark' : 'light',
    staticAccent: accent,
    staticSurface: base.surface,
    staticText: base.text,
    surfaceGradient,
    accentGradient,
    shadowAccent,
    ...theme.shadows[scheme],
  };
}

// Material You stays available as an explicit opt-in on Android only; every
// other platform uses the default indigo on the hand-tuned neutral surfaces.
function systemTokens(dark: boolean, theme: ThemeDefinition = classicTheme): ThemeTokens {
  const fallback = accentTokens(theme.accent.default, dark, theme);
  if (Platform.OS !== 'android') return fallback;
  const { accentGradient, shadowAccent } = accentMaterial(fallback.staticAccent, dark, theme.material);
  return {
    ...fallback,
    accent: Color.android.dynamic.primary,
    accentText: Color.android.dynamic.primary,
    onAccent: Color.android.dynamic.onPrimary,
    accentContainer: Color.android.dynamic.primaryContainer,
    onAccentContainer: Color.android.dynamic.onPrimaryContainer,
    background: Color.android.dynamic.surface,
    surface: Color.android.dynamic.surfaceContainerLow,
    surfaceElevated: Color.android.dynamic.surfaceContainer,
    surfaceMuted: Color.android.dynamic.surfaceContainerHigh,
    surfaceSunken: Color.android.dynamic.surfaceContainerHighest,
    text: Color.android.dynamic.onSurface,
    textMuted: Color.android.dynamic.onSurfaceVariant,
    border: Color.android.dynamic.outlineVariant,
    // `surface` is now an opaque platform color with no JS-readable hex, so a
    // gradient computed from it would be meaningless; the accent gradient is
    // still derived from a real hex seed and stays valid.
    surfaceGradient: undefined,
    accentGradient,
    shadowAccent,
  };
}

// The appearance preview has to show the accent the provider will actually
// apply. It used to rebuild its own swatch from a hard-coded indigo literal, so
// Android's Material You accent previewed as plain blue no matter what the
// wallpaper produced. Reusing the same two builders is what keeps the preview
// and the applied theme from drifting apart again.
//
// Android's dynamic accent is an opaque platform color with no JS-readable hex,
// so callers must render these values directly and must not pass them through
// the hex helpers in `@/theme/tokens`.
export function previewAccentTokens(source: AccentSource, accentHex: string, dark: boolean, theme: ThemeDefinition = classicTheme) {
  const tokens = source === 'system' ? systemTokens(dark, theme) : accentTokens(accentHex, dark, theme);
  return { accent: tokens.accent, onAccent: tokens.onAccent };
}

/**
 * Which accent a theme lets the settings choose: `system` themes always use the platform accent,
 * `fixed` themes ignore the settings entirely, and `user` themes follow `accentSource`/`accentHex`.
 */
export function resolveAccentChoice(
  theme: ThemeDefinition,
  settings: { accentSource: AccentSource; accentHex: string },
): { kind: 'system' } | { kind: 'seed'; seed: string } {
  switch (theme.accent.mode) {
    case 'system':
      return { kind: 'system' };
    case 'fixed':
      return { kind: 'seed', seed: theme.accent.default };
    default:
      return settings.accentSource === 'system' ? { kind: 'system' } : { kind: 'seed', seed: settings.accentHex };
  }
}

export function QashyThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useFinanceState();
  const { isRtl } = useLocalization();
  const systemScheme = useColorScheme();
  const mode = settings.themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : settings.themeMode;
  // A custom theme that is not loaded yet, was deleted, or no longer resolves is classic; the stored id is left alone.
  const { themes: customThemes } = useCustomThemes();
  const theme = useMemo(() => getTheme(settings.themeId, customThemes), [settings.themeId, customThemes]);
  const accentChoice = resolveAccentChoice(theme, settings);
  const usesSystemAccent = accentChoice.kind === 'system';
  const seed = accentChoice.kind === 'seed' ? accentChoice.seed : theme.accent.default;
  const tokens = useMemo(
    () => (usesSystemAccent ? systemTokens(mode === 'dark', theme) : accentTokens(seed, mode === 'dark', theme)),
    [mode, seed, theme, usesSystemAccent],
  );

  useEffect(() => {
    if (process.env.EXPO_OS !== 'web' && typeof Appearance.setColorScheme === 'function') {
      Appearance.setColorScheme(settings.themeMode === 'system' ? 'unspecified' : settings.themeMode);
    }
  }, [settings.themeMode]);

  // Browser chrome the React tree cannot reach: the focus ring and selection
  // colors declared in `+html.tsx`, the UA color scheme that decides whether
  // scrollbars and form widgets paint light or dark, and the address-bar tint.
  //
  // `color-scheme` is pinned to the resolved mode rather than left at
  // `light dark`, because a user who forces dark while the system is light
  // would otherwise get a white scrollbar down the side of a dark page.
  useEffect(() => {
    if (process.env.EXPO_OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    const cssColor = (value: ColorValue, fallback: string) => (typeof value === 'string' ? value : fallback);
    root.style.colorScheme = mode;
    root.style.setProperty('--qashy-focus', cssColor(tokens.accent, tokens.staticAccent));
    root.style.setProperty('--qashy-selection', cssColor(tokens.accentContainer, `${tokens.staticAccent}33`));
    root.style.setProperty('--qashy-selection-text', cssColor(tokens.onAccentContainer, 'inherit'));

    // Following the system means each media-scoped meta stays truthful. Forcing
    // a mode means only one of them can ever match, so both carry that surface.
    const background = cssColor(tokens.background, theme.palette[mode].background);
    const light = document.getElementById('qashy-theme-color-light');
    const dark = document.getElementById('qashy-theme-color-dark');
    light?.setAttribute('content', settings.themeMode === 'system' ? theme.palette.light.background : background);
    dark?.setAttribute('content', settings.themeMode === 'system' ? theme.palette.dark.background : background);
  }, [mode, settings.themeMode, theme, tokens]);

  const baseNavigation = mode === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseNavigation,
    // Native stack headers (titles, large titles, back labels) use the app face too.
    fonts: {
      regular: { fontFamily: fontStyle('regular', theme.type).fontFamily as string, fontWeight: 'normal' as const },
      medium: { fontFamily: fontStyle('medium', theme.type).fontFamily as string, fontWeight: 'normal' as const },
      bold: { fontFamily: fontStyle('semibold', theme.type).fontFamily as string, fontWeight: 'normal' as const },
      heavy: { fontFamily: fontStyle('bold', theme.type).fontFamily as string, fontWeight: 'normal' as const },
    },
    colors: {
      ...baseNavigation.colors,
      primary: tokens.staticAccent,
      background: typeof tokens.background === 'string' ? tokens.background : baseNavigation.colors.background,
      card: typeof tokens.surface === 'string' ? tokens.surface : baseNavigation.colors.card,
      text: typeof tokens.text === 'string' ? tokens.text : baseNavigation.colors.text,
      border: typeof tokens.border === 'string' ? tokens.border : baseNavigation.colors.border,
    },
  };

  return (
    <ThemeContext value={tokens}>
      <Host
        style={{ flex: 1, direction: isRtl ? 'rtl' : 'ltr' }}
        colorScheme={mode}
        seedColor={usesSystemAccent && Platform.OS === 'android' ? undefined : tokens.staticAccent}>
        <DirectionScope direction={isRtl ? 'rtl' : 'ltr'} style={{ flex: 1 }}>
          <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>
        </DirectionScope>
      </Host>
    </ThemeContext>
  );
}

export function useQashyTheme() {
  useColorScheme();
  const theme = use(ThemeContext);
  if (!theme) throw new Error('useQashyTheme must be used inside QashyThemeProvider.');
  return theme;
}
