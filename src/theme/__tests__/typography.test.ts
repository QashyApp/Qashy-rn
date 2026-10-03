import { fontIdsForTheme, isRegisteredFamily, scriptsCovered } from '@/theme/fonts';
import { classicTheme } from '@/theme/themes/classic';
import type { TypeSpec } from '@/theme/themes/types';
import { fontFamilies, numericFontFamilies } from '@/theme/tokens';
import { FONT_ASSETS, fontStyle, numericFontStyle, withAppFont } from '@/theme/typography';

// Jest runs with EXPO_OS === 'ios' by default (see jest-expo's babel caller
// platform), so these assert the native branch: a bare family, no fontWeight.
describe('numericFontStyle', () => {
  it('resolves each weight to its Space Grotesk family on native', () => {
    expect(numericFontStyle('medium').fontFamily).toBe(numericFontFamilies.medium);
    expect(numericFontStyle('semibold').fontFamily).toBe(numericFontFamilies.semibold);
    expect(numericFontStyle('bold').fontFamily).toBe(numericFontFamilies.bold);
  });

  it('falls back regular to medium: there is no bundled 400-weight file', () => {
    expect(numericFontStyle('regular').fontFamily).toBe(numericFontFamilies.medium);
  });
});

describe('withAppFont numeric face', () => {
  it('maps fontWeight 700 to SpaceGrotesk_700Bold', () => {
    const resolved = withAppFont({ fontWeight: '700' }, 'regular', 'numeric');
    expect(resolved.fontFamily).toBe(numericFontFamilies.bold);
  });

  it('still resolves the text face (Rubik) when face is omitted', () => {
    const resolved = withAppFont({ fontWeight: '700' });
    expect(resolved.fontFamily).toBe('Rubik_700Bold');
  });

  it('treats an existing SpaceGrotesk family as "ours" and still overrides it', () => {
    const resolved = withAppFont({ fontFamily: numericFontFamilies.medium, fontWeight: '600' }, 'regular', 'numeric');
    expect(resolved.fontFamily).toBe(numericFontFamilies.semibold);
  });
});

describe('theme-aware typography', () => {
  const latinThenRubik: TypeSpec = {
    ...classicTheme.type,
    text: { family: 'space-grotesk', fallbacks: ['rubik'] },
  };

  it('classic native output is unchanged', () => {
    expect(fontStyle('regular')).toEqual({ fontFamily: fontFamilies.regular, fontWeight: undefined });
    expect(fontStyle('bold')).toEqual({ fontFamily: fontFamilies.bold, fontWeight: undefined });
    expect(numericFontStyle('regular')).toEqual({ fontFamily: numericFontFamilies.medium, fontWeight: undefined });
  });

  it('keeps FONT_ASSETS identical to the pre-registry map', () => {
    expect(Object.keys(FONT_ASSETS).sort()).toEqual([...Object.values(fontFamilies), ...Object.values(numericFontFamilies), 'PixelifySans_400Regular', 'PixelifySans_500Medium', 'PixelifySans_600SemiBold', 'PixelifySans_700Bold'].sort());
  });

  it('resolves a custom type spec on native', () => {
    expect(fontStyle('bold', latinThenRubik).fontFamily).toBe('SpaceGrotesk_700Bold');
    expect(withAppFont({ fontWeight: '700' }, 'regular', 'text', latinThenRubik).fontFamily).toBe('SpaceGrotesk_700Bold');
  });

  it('leaves a foreign fontFamily alone', () => {
    expect(withAppFont({ fontFamily: 'Courier', fontWeight: '700' })).toEqual({ fontFamily: 'Courier', fontWeight: '700' });
  });

  it('registers exactly the loaded families', () => {
    expect(isRegisteredFamily('Rubik_400Regular')).toBe(true);
    expect(isRegisteredFamily('SpaceGrotesk_700Bold')).toBe(true);
    expect(isRegisteredFamily('Courier')).toBe(false);
  });

  it('derives font ids and script coverage from the type spec', () => {
    expect(fontIdsForTheme(classicTheme.type)).toEqual(['rubik', 'space-grotesk']);
    expect([...scriptsCovered(classicTheme.type)].sort()).toEqual(['hebrew', 'latin']);
    expect([...scriptsCovered({ ...classicTheme.type, text: { family: 'space-grotesk', fallbacks: [] } })]).toEqual(['latin']);
  });
});
