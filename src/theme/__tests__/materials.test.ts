import type { ColorValue } from 'react-native';

import { materialStyle, type Material } from '@/theme/materials';
import type { ThemeTokens } from '@/theme/theme';
import { classicTheme } from '@/theme/themes/classic';
import { darkTokens, lightTokens } from '@/theme/tokens';

const MATERIALS: Material[] = ['card', 'raised', 'sunken', 'control', 'controlPressed', 'accent', 'accentPressed', 'selected', 'overlay', 'well'];

/**
 * A minimal but structurally faithful `ThemeTokens` fixture. `androidPlatform`
 * simulates the one case where the theme really does hand out opaque platform
 * colors (Android Material You): `background`/`surface`/etc. become
 * non-string sentinels, the way `Color.android.dynamic.*` would render, while
 * every shadow and gradient stays a real, JS-readable string — exactly what
 * `systemTokens` guarantees in `theme.tsx` by deriving `accentGradient` and
 * `shadowAccent` from a real hex seed even on Android, and by setting
 * `surfaceGradient` to `undefined` rather than trying to gradient a platform
 * color.
 */
function buildTheme(dark: boolean, androidPlatform: boolean): ThemeTokens {
  const base = dark ? darkTokens : lightTokens;
  const opaque = (label: string): ColorValue => ({ toString: () => label }) as unknown as ColorValue;
  return {
    mode: dark ? 'dark' : 'light',
    space: classicTheme.space,
    radius: classicTheme.radius,
    tile: classicTheme.tile,
    iconSize: classicTheme.iconSize,
    motion: classicTheme.motion,
    iconSet: classicTheme.icons.set,
    type: classicTheme.type,
    charts: classicTheme.charts,
    gradients: true,
    accent: androidPlatform ? opaque('accent') : '#5966E9',
    accentText: androidPlatform ? opaque('accentText') : '#4755D6',
    onAccent: androidPlatform ? opaque('onAccent') : '#FFFFFF',
    accentContainer: androidPlatform ? opaque('accentContainer') : '#E4E6FB',
    onAccentContainer: androidPlatform ? opaque('onAccentContainer') : '#2A2F80',
    background: androidPlatform ? opaque('background') : base.background,
    surface: androidPlatform ? opaque('surface') : base.surface,
    surfaceElevated: androidPlatform ? opaque('surfaceElevated') : base.surfaceElevated,
    surfaceMuted: androidPlatform ? opaque('surfaceMuted') : base.surfaceMuted,
    surfaceSunken: androidPlatform ? opaque('surfaceSunken') : base.surfaceSunken,
    text: androidPlatform ? opaque('text') : base.text,
    textMuted: androidPlatform ? opaque('textMuted') : base.textMuted,
    border: androidPlatform ? opaque('border') : base.border,
    positive: base.positive,
    onPositive: '#FFFFFF',
    negative: base.negative,
    onNegative: '#FFFFFF',
    warning: base.warning,
    onWarning: '#000000',
    transfer: base.transfer,
    glassTint: dark ? 'dark' : 'light',
    staticAccent: '#5966E9',
    staticSurface: base.surface,
    staticText: base.text,
    surfaceGradient: androidPlatform ? undefined : 'linear-gradient(180deg, #ffffff, #f0f0f0)',
    accentGradient: 'linear-gradient(180deg, #7079ec, #5966e9)',
    shadowCard: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(0,0,0,0.06)',
    shadowRaised: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 4px rgba(0,0,0,0.06)',
    shadowControl: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(0,0,0,0.1)',
    shadowControlPressed: 'inset 0 2px 4px rgba(0,0,0,0.16)',
    shadowSunken: 'inset 0 1px 3px rgba(0,0,0,0.12)',
    shadowOverlay: '0 20px 48px rgba(0,0,0,0.18)',
    shadowFab: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 4px 14px rgba(0,0,0,0.28)',
    shadowAccent: 'inset 0 1px 0 rgba(255,255,255,0.28), 0 1px 2px rgba(89,102,233,0.3), 0 6px 14px rgba(89,102,233,0.45)',
    scrim: 'rgba(12,13,17,0.42)',
  };
}

describe('materialStyle', () => {
  it.each([
    ['light', false],
    ['dark', false],
    ['android system (opaque platform colors)', true],
  ] as const)('returns a string boxShadow for every material in %s mode', (_label, androidPlatform) => {
    const theme = buildTheme(false, androidPlatform);
    MATERIALS.forEach((material) => {
      const style = materialStyle(theme, material);
      expect(typeof style.boxShadow).toBe('string');
    });
  });

  it('never reads a platform color for a gradient or shadow value', () => {
    const theme = buildTheme(false, true);
    MATERIALS.forEach((material) => {
      const style = materialStyle(theme, material) as Record<string, unknown>;
      expect(typeof style.boxShadow).toBe('string');
      const gradient = style.backgroundImage ?? style.experimental_backgroundImage;
      if (gradient !== undefined) expect(typeof gradient).toBe('string');
    });
  });

  it('omits the gradient on Android system accent, where surfaceGradient is undefined', () => {
    const theme = buildTheme(false, true);
    const card = materialStyle(theme, 'card') as Record<string, unknown>;
    expect(card.backgroundImage ?? card.experimental_backgroundImage).toBeUndefined();
    // The accent material still gradients: it is derived from a real hex seed.
    const accent = materialStyle(theme, 'accent') as Record<string, unknown>;
    expect(typeof (accent.backgroundImage ?? accent.experimental_backgroundImage)).toBe('string');
  });

  it('gives sunken and pressed materials an inset-only shadow with no distinct gradient key required', () => {
    const theme = buildTheme(true, false);
    const sunken = materialStyle(theme, 'sunken');
    expect(sunken.backgroundColor).toBe(theme.surfaceSunken);
    expect(sunken.boxShadow).toBe(theme.shadowSunken);
  });
});
