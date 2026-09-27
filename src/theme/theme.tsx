import { Host } from '@expo/ui';
import { Color, DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { createContext, use, useEffect, useMemo, type ReactNode } from 'react';
import {
  Appearance,
  Platform,
  type ColorValue,
  useColorScheme,
} from 'react-native';

import { QASHY_ACCENT } from '@/domain/defaults';
import type { AccentSource } from '@/domain/models';
import { useLocalization } from '@/localization/localization';
import { useFinanceState } from '@/providers/finance-provider';
import {
  accessibleAccentColor,
  darkTokens,
  ensureContrast,
  fontFamilies,
  lightTokens,
  mixHex,
  readableTextColor,
  withAlpha,
} from '@/theme/tokens';

export interface ThemeTokens {
  mode: 'light' | 'dark';
  accent: ColorValue;
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

const lightShadows = {
  shadowCard: 'inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 2px rgba(25, 27, 32, 0.06), 0 8px 20px -10px rgba(25, 27, 32, 0.14)',
  shadowRaised: 'inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 4px rgba(25, 27, 32, 0.06), 0 14px 32px -12px rgba(25, 27, 32, 0.20)',
  shadowControl: 'inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(25, 27, 32, 0.10), 0 3px 8px -3px rgba(25, 27, 32, 0.16)',
  shadowControlPressed: 'inset 0 2px 4px rgba(25, 27, 32, 0.16), inset 0 0 0 1px rgba(25, 27, 32, 0.04)',
  shadowSunken: 'inset 0 1px 3px rgba(25, 27, 32, 0.12), inset 0 -1px 0 rgba(255, 255, 255, 0.7)',
  shadowOverlay: '0 20px 48px rgba(25, 27, 32, 0.18)',
  shadowFab: 'inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 4px 14px rgba(25, 27, 32, 0.28)',
  scrim: 'rgba(12, 13, 17, 0.42)',
} as const;

const darkShadows = {
  shadowCard: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 1px 0 rgba(0, 0, 0, 0.45), 0 10px 24px -12px rgba(0, 0, 0, 0.7)',
  shadowRaised: 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 16px 36px -12px rgba(0, 0, 0, 0.75)',
  shadowControl: 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.5)',
  shadowControlPressed: 'inset 0 2px 5px rgba(0, 0, 0, 0.55)',
  shadowSunken: 'inset 0 1px 3px rgba(0, 0, 0, 0.55), inset 0 -1px 0 rgba(255, 255, 255, 0.04)',
  shadowOverlay: '0 22px 52px rgba(0, 0, 0, 0.6)',
  shadowFab: 'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 6px 18px rgba(0, 0, 0, 0.58)',
  scrim: 'rgba(0, 0, 0, 0.56)',
} as const;

const ThemeContext = createContext<ThemeTokens | null>(null);

/** Builds the accent-dependent shadow/gradient pair that no static const can hold. */
function accentMaterial(accent: string, dark: boolean) {
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
function accentTokens(seed: string, dark: boolean): ThemeTokens {
  const base = dark ? darkTokens : lightTokens;
  const accent = accessibleAccentColor(seed, base.surface, base.text);
  const accentContainer = mixHex(accent, base.surface, dark ? 0.78 : 0.86);
  const surfaceGradient = dark
    ? `linear-gradient(180deg, ${mixHex(base.surface, '#FFFFFF', 0.035)}, ${base.surface})`
    : `linear-gradient(180deg, #FFFFFF, ${mixHex('#FFFFFF', base.background, 0.35)})`;
  const { accentGradient, shadowAccent } = accentMaterial(accent, dark);
  return {
    mode: dark ? 'dark' : 'light',
    accent,
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
    ...(dark ? darkShadows : lightShadows),
  };
}

// Material You stays available as an explicit opt-in on Android only; every
// other platform uses the default indigo on the hand-tuned neutral surfaces.
function systemTokens(dark: boolean): ThemeTokens {
  const fallback = accentTokens(QASHY_ACCENT, dark);
  if (Platform.OS !== 'android') return fallback;
  const { accentGradient, shadowAccent } = accentMaterial(fallback.staticAccent, dark);
  return {
    ...fallback,
    accent: Color.android.dynamic.primary,
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
export function previewAccentTokens(source: AccentSource, accentHex: string, dark: boolean) {
  const tokens = source === 'system' ? systemTokens(dark) : accentTokens(accentHex, dark);
  return { accent: tokens.accent, onAccent: tokens.onAccent };
}

export function QashyThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useFinanceState();
  const { isRtl } = useLocalization();
  const systemScheme = useColorScheme();
  const mode = settings.themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : settings.themeMode;
  const usesSystemAccent = settings.accentSource === 'system';
  const seed = usesSystemAccent ? QASHY_ACCENT : settings.accentHex;
  const tokens = useMemo(
    () => (usesSystemAccent ? systemTokens(mode === 'dark') : accentTokens(seed, mode === 'dark')),
    [mode, seed, usesSystemAccent],
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
    const background = cssColor(tokens.background, mode === 'dark' ? darkTokens.background : lightTokens.background);
    const light = document.getElementById('qashy-theme-color-light');
    const dark = document.getElementById('qashy-theme-color-dark');
    light?.setAttribute('content', settings.themeMode === 'system' ? lightTokens.background : background);
    dark?.setAttribute('content', settings.themeMode === 'system' ? darkTokens.background : background);
  }, [mode, settings.themeMode, tokens]);

  const baseNavigation = mode === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseNavigation,
    // Native stack headers (titles, large titles, back labels) use the app face too.
    fonts: {
      regular: { fontFamily: fontFamilies.regular, fontWeight: 'normal' as const },
      medium: { fontFamily: fontFamilies.medium, fontWeight: 'normal' as const },
      bold: { fontFamily: fontFamilies.semibold, fontWeight: 'normal' as const },
      heavy: { fontFamily: fontFamilies.bold, fontWeight: 'normal' as const },
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
        <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>
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
