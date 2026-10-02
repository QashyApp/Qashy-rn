import Ionicons from '@expo/vector-icons/Ionicons';

import { ICON_CATALOG, SUGGESTED_GLYPHS, findCatalogIcon, legacyIconLabel, searchCatalog } from '@/theme/icon-catalog';
import { emojiIconId, isValidIconId, normalizeEmoji, parseIconId } from '@/utils/icon-id';

describe('icon catalog', () => {
  it('only references glyphs the bundled font provides', () => {
    const missing = ICON_CATALOG.filter((icon) => !(icon.id.slice('ion:'.length) in Ionicons.glyphMap)).map((icon) => icon.glyph);
    expect(missing).toEqual([]);
  });

  it('is large, unique, and every id is valid', () => {
    expect(ICON_CATALOG.length).toBeGreaterThan(250);
    expect(new Set(ICON_CATALOG.map((icon) => icon.id)).size).toBe(ICON_CATALOG.length);
    expect(ICON_CATALOG.every((icon) => isValidIconId(icon.id))).toBe(true);
  });

  it('resolves every suggested glyph', () => {
    for (const glyph of [...SUGGESTED_GLYPHS.expense, ...SUGGESTED_GLYPHS.income]) {
      expect(findCatalogIcon(`ion:${glyph}-outline`)).toBeDefined();
    }
  });

  it('searches names and aliases, narrowed by topic', () => {
    expect(searchCatalog('coffee', 'all').map((icon) => icon.glyph)).toContain('cafe');
    expect(searchCatalog('ice cream', 'all').map((icon) => icon.glyph)).toContain('ice-cream');
    expect(searchCatalog('', 'food').length).toBeGreaterThan(5);
    expect(searchCatalog('car', 'food').map((icon) => icon.glyph)).not.toContain('car');
    expect(searchCatalog('zzzzzz', 'all')).toEqual([]);
  });

  it('names legacy ids', () => {
    expect(legacyIconLabel('fork.knife')).toBe('Dining');
    expect(legacyIconLabel('nope')).toBeUndefined();
  });
});

describe('icon ids', () => {
  it('parses the three formats', () => {
    expect(parseIconId('ion:beer-outline')).toEqual({ kind: 'ion', glyph: 'beer-outline' });
    expect(parseIconId(emojiIconId('🍕'))).toEqual({ kind: 'emoji', emoji: '🍕' });
    expect(parseIconId('fork.knife')).toEqual({ kind: 'legacy', name: 'fork.knife' });
  });

  it('accepts exactly one emoji', () => {
    expect(normalizeEmoji('🍕')).toBe('🍕');
    expect(normalizeEmoji(' 🏋️ ')).toBe('🏋️');
    expect(normalizeEmoji('👨‍👩‍👧')).toBe('👨‍👩‍👧');
    expect(normalizeEmoji('🇮🇱')).toBe('🇮🇱');
    expect(normalizeEmoji('🍕🍔')).toBeNull();
    expect(normalizeEmoji('a')).toBeNull();
    expect(normalizeEmoji('')).toBeNull();
  });

  it('rejects malformed ids', () => {
    expect(isValidIconId('')).toBe(false);
    expect(isValidIconId('ion:')).toBe(false);
    expect(isValidIconId('ion:Bad Glyph')).toBe(false);
    expect(isValidIconId('emoji:ab')).toBe(false);
    expect(isValidIconId('<script>')).toBe(false);
    expect(isValidIconId('cart')).toBe(true);
    expect(isValidIconId('chart.line.uptrend.xyaxis')).toBe(true);
    expect(isValidIconId('emoji:🍕')).toBe(true);
  });
});
