import { bevelAccentShadow, bevelShadowSet, serializeShadow, shadowBlurs } from '@/theme/shadow';
import { darkTokens, lightTokens } from '@/theme/tokens';

describe('shadow serializer', () => {
  it('serializes layers into a CSS box-shadow string', () => {
    expect(serializeShadow([{ inset: true, x: 0, y: 1, blur: 0, color: '#fff' }, { x: 2, y: 3, blur: 4, spread: 1, color: 'rgba(0,0,0,0.5)' }])).toBe(
      'inset 0px 1px 0px 0px #fff, 2px 3px 4px 1px rgba(0,0,0,0.5)',
    );
  });

  it('reads blur radii without being fooled by commas inside rgba()', () => {
    expect(shadowBlurs('inset 0 1px 0 rgba(255,255,255,0.28), 0 6px 14px -4px rgba(0,0,0,0.3)')).toEqual([0, 14]);
    expect(shadowBlurs('none')).toEqual([]);
  });
});

describe('bevel engine', () => {
  const sets = [
    bevelShadowSet(lightTokens, 'light', 2),
    bevelShadowSet(darkTokens, 'dark', 3),
  ];

  it.each([0, 1])('emits only hard edges (no blur) for scheme %i', (index) => {
    const { scrim, ...shadows } = sets[index];
    expect(scrim).toMatch(/^rgba\(/);
    for (const [name, value] of Object.entries(shadows)) {
      const blurs = shadowBlurs(value);
      expect(blurs.length).toBeGreaterThan(0);
      expect({ name, blurs: blurs.filter((blur) => blur > 0) }).toEqual({ name, blurs: [] });
    }
  });

  it('has a hard-edged accent shadow', () => {
    expect(shadowBlurs(bevelAccentShadow('#5966E9', 2)).every((blur) => blur === 0)).toBe(true);
  });
});
