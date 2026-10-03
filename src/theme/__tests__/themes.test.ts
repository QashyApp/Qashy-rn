import { classicTheme } from '@/theme/themes/classic';
import { BUILT_IN_THEMES, getTheme } from '@/theme/themes/registry';
import { isValidThemeId, type ThemeDefinition } from '@/theme/themes/types';
import { assertThemeDefinition } from '@/theme/themes/validate';
import { darkTokens, iconSize, lightTokens, motion, radius, space, tile } from '@/theme/tokens';

const custom = (over: Partial<ThemeDefinition> = {}): ThemeDefinition => ({ ...classicTheme, id: 'my-theme', name: 'Mine', ...over });

describe('built-in themes', () => {
  it.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))('%s is a valid theme', (_id, theme) => {
    expect(() => assertThemeDefinition(theme)).not.toThrow();
  });

  it('keeps unique ids', () => {
    const ids = BUILT_IN_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classic carries the shipped palettes unchanged', () => {
    expect(classicTheme.palette.light).toBe(lightTokens);
    expect(classicTheme.palette.dark).toBe(darkTokens);
  });
});

describe('classic scales', () => {
  it('are the shipped constants, so moving them into the theme changed nothing', () => {
    expect(classicTheme.space).toEqual(space);
    expect(classicTheme.radius).toEqual(radius);
    expect(classicTheme.tile).toEqual(tile);
    expect(classicTheme.iconSize).toEqual(iconSize);
    expect(classicTheme.motion).toEqual(motion);
  });
});

describe('getTheme', () => {
  it('falls back to classic for an unknown, empty or missing id', () => {
    expect(getTheme('nope')).toBe(classicTheme);
    expect(getTheme('')).toBe(classicTheme);
    expect(getTheme(undefined)).toBe(classicTheme);
  });

  it('resolves a custom theme, but never lets it shadow a built-in', () => {
    const mine = custom();
    expect(getTheme('my-theme', [mine])).toBe(mine);
    expect(getTheme('classic', [custom({ id: 'classic' })])).toBe(classicTheme);
  });
});

describe('assertThemeDefinition', () => {
  it('requires both light and dark', () => {
    expect(() => assertThemeDefinition(custom({ palette: { light: lightTokens } as ThemeDefinition['palette'] }))).toThrow(/palette\.dark/);
    expect(() => assertThemeDefinition(custom({ shadows: { dark: classicTheme.shadows.dark } as ThemeDefinition['shadows'] }))).toThrow(/shadows\.light/);
  });

  it('rejects a non-hex palette color and a bad accent', () => {
    const bad = { ...lightTokens, text: 'red' };
    expect(() => assertThemeDefinition(custom({ palette: { light: bad, dark: darkTokens } }))).toThrow(/palette\.light\.text/);
    expect(() => assertThemeDefinition(custom({ accent: { mode: 'user', default: '#12', presets: [] } }))).toThrow(/accent\.default/);
  });

  it('rejects a blank shadow', () => {
    const shadows = { light: { ...classicTheme.shadows.light, shadowCard: ' ' }, dark: classicTheme.shadows.dark };
    expect(() => assertThemeDefinition(custom({ shadows }))).toThrow(/shadowCard/);
  });
});

describe('assertThemeDefinition scales', () => {
  it('rejects a missing or negative step', () => {
    expect(() => assertThemeDefinition(custom({ space: { ...space, md: -1 } }))).toThrow(/space.md/);
    expect(() => assertThemeDefinition(custom({ radius: { ...radius, card: Number.NaN } }))).toThrow(/radius.card/);
    const { sm: _omitted, ...rest } = space;
    expect(() => assertThemeDefinition(custom({ space: rest as unknown as ThemeDefinition['space'] }))).toThrow(/space.sm/);
  });

  it('rejects motion that cannot run', () => {
    expect(() => assertThemeDefinition(custom({ motion: { ...motion, pressScale: 1.5 } }))).toThrow(/pressScale/);
    expect(() => assertThemeDefinition(custom({ motion: { ...motion, duration: { ...motion.duration, base: 0 } } }))).toThrow(/duration.base/);
  });
});

describe('isValidThemeId', () => {
  it('accepts lowercase hyphenated ids only', () => {
    expect(isValidThemeId('classic')).toBe(true);
    expect(isValidThemeId('my-theme-2')).toBe(true);
    for (const bad of ['', 'Classic', '-x', 'a b', 'a'.repeat(49), 5, null, undefined]) expect(isValidThemeId(bad)).toBe(false);
  });
});

describe('type validation', () => {
  it('accepts a Latin-only text face backed by a Hebrew-capable fallback', () => {
    const type = { ...classicTheme.type, text: { family: 'space-grotesk', fallbacks: ['rubik'] } };
    expect(() => assertThemeDefinition(custom({ type }))).not.toThrow();
  });

  it('rejects a Latin-only text face with no Hebrew fallback', () => {
    const type = { ...classicTheme.type, text: { family: 'space-grotesk', fallbacks: [] } };
    expect(() => assertThemeDefinition(custom({ type }))).toThrow(/Hebrew/);
  });

  it('allows a Latin-only numeric stack', () => {
    const type = { ...classicTheme.type, numeric: { family: 'space-grotesk', fallbacks: [] } };
    expect(() => assertThemeDefinition(custom({ type }))).not.toThrow();
  });

  it('rejects an unknown font id', () => {
    const type = { ...classicTheme.type, numeric: { family: 'comic-sans', fallbacks: [] } };
    expect(() => assertThemeDefinition(custom({ type }))).toThrow(/unknown font/);
  });

  it('rejects a bad scale entry', () => {
    const scale = { ...classicTheme.type.scale, body: { ...classicTheme.type.scale.body, lineHeight: 1 } };
    expect(() => assertThemeDefinition(custom({ type: { ...classicTheme.type, scale } }))).toThrow(/lineHeight/);
    const missing = { ...classicTheme.type.scale } as Record<string, unknown>;
    delete missing.caption;
    expect(() => assertThemeDefinition(custom({ type: { ...classicTheme.type, scale: missing as never } }))).toThrow(/caption/);
  });
});
