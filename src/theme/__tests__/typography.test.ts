import { numericFontFamilies } from '@/theme/tokens';
import { numericFontStyle, withAppFont } from '@/theme/typography';

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
