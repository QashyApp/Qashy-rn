import Ionicons from '@expo/vector-icons/Ionicons';

import { ICON_CATALOG } from '@/theme/icon-catalog';
import {
  ICON_SETS,
  ICON_SET_IDS,
  IONICON_BY_SF_NAME,
  PIXEL_BITMAPS,
  PIXEL_GRID,
  bitmapToPath,
  getIconSet,
  iconSetCoverage,
  resolveIconRender,
} from '@/theme/icon-sets';
import { classicTheme } from '@/theme/themes/classic';
import { assertThemeDefinition } from '@/theme/themes/validate';
import { parseIconId } from '@/utils/icon-id';

const CATALOG_GLYPHS = ICON_CATALOG.map((icon) => `${icon.glyph}-outline`);
const SF_GLYPHS = Array.from(new Set(Object.values(IONICON_BY_SF_NAME)));

describe('icon sets', () => {
  it('registers ionicons and pixel', () => {
    expect(ICON_SET_IDS).toEqual(expect.arrayContaining(['ionicons', 'pixel']));
    for (const id of ICON_SET_IDS) expect(ICON_SETS[id].id).toBe(id);
  });

  it('ionicons is the identity', () => {
    expect(getIconSet('ionicons').resolve('cart-outline')).toEqual({ kind: 'ionicon', name: 'cart-outline' });
  });

  it('unknown set ids fall back to ionicons without throwing', () => {
    expect(getIconSet('nope').id).toBe('ionicons');
    expect(getIconSet('constructor').id).toBe('ionicons');
  });

  it('pixel glyphs are syntactically valid', () => {
    const names = Object.keys(PIXEL_BITMAPS);
    expect(names.length).toBeGreaterThanOrEqual(33);
    for (const name of names) {
      const rows = PIXEL_BITMAPS[name];
      expect(rows).toHaveLength(PIXEL_GRID);
      for (const row of rows) {
        expect(row).toHaveLength(PIXEL_GRID);
        expect(row).toMatch(/^[#.]+$/);
      }
      expect(rows.join('')).toContain('#');
      const glyph = getIconSet('pixel').resolve(name);
      expect(glyph?.kind).toBe('svg');
      if (glyph?.kind === 'svg') {
        expect(glyph.viewBox).toBe('0 0 16 16');
        expect(glyph.paths.length).toBeGreaterThan(0);
        expect(glyph.paths.every((path) => path.d.length > 0 && /^(M\d+ \d+h\d+v1h-\d+z)+$/.test(path.d))).toBe(true);
      }
    }
  });

  it('every pixel glyph is a real Ionicons glyph, so it can stand in for it', () => {
    expect(Object.keys(PIXEL_BITMAPS).filter((name) => !(name in Ionicons.glyphMap))).toEqual([]);
  });

  it('covers the required starter glyphs', () => {
    const required = [
      'add', 'remove', 'checkmark', 'close', 'chevron-forward', 'chevron-back', 'chevron-down',
      'arrow-up', 'arrow-down', 'arrow-forward', 'search', 'home', 'home-outline', 'wallet', 'wallet-outline',
      'settings-outline', 'trash-outline', 'create-outline', 'calendar-outline', 'receipt-outline',
      'pie-chart', 'pie-chart-outline', 'swap-horizontal', 'ellipsis-horizontal-circle',
      'ellipsis-horizontal-circle-outline', 'cart-outline', 'restaurant-outline', 'car-outline',
      'heart-outline', 'gift-outline', 'cash-outline', 'lock-closed-outline', 'sync-outline',
    ];
    expect(iconSetCoverage('pixel', required).missing).toEqual([]);
  });

  it('builds paths from bitmaps', () => {
    expect(bitmapToPath(['#.##', '....'])).toBe('M0 0h1v1h-1zM2 0h2v1h-2z');
  });

  it('computes coverage against the catalog and the legacy map; the gap takes the ionicons path', () => {
    const catalog = iconSetCoverage('pixel', CATALOG_GLYPHS);
    const legacy = iconSetCoverage('pixel', SF_GLYPHS);
    expect(catalog.covered.length + catalog.missing.length).toBe(CATALOG_GLYPHS.length);
    expect(legacy.covered.length).toBeGreaterThan(10);
    expect(legacy.missing.length).toBeGreaterThan(0);
    expect(iconSetCoverage('ionicons', CATALOG_GLYPHS).missing).toEqual([]);
    for (const glyph of [...catalog.missing, ...legacy.missing]) {
      expect(resolveIconRender({ kind: 'ion', glyph }, 'pixel')).toEqual({ kind: 'ionicon', name: glyph });
    }
    for (const glyph of [...catalog.covered, ...legacy.covered]) {
      expect(resolveIconRender({ kind: 'ion', glyph }, 'pixel').kind).toBe('svg');
    }
  });
});

describe('resolveIconRender', () => {
  it('ignores the set for emoji', () => {
    for (const set of ['ionicons', 'pixel', 'nope']) {
      expect(resolveIconRender(parseIconId('emoji:🍕'), set)).toEqual({ kind: 'emoji', emoji: '🍕' });
      expect(resolveIconRender(parseIconId('emoji:🍕'), set, true)).toEqual({ kind: 'emoji', emoji: '🍕' });
    }
  });

  it('draws unknown ion glyphs as help-circle-outline in every set', () => {
    for (const set of ['ionicons', 'pixel']) {
      expect(resolveIconRender(parseIconId('ion:not-a-glyph'), set)).toEqual({ kind: 'ionicon', name: 'help-circle-outline' });
    }
  });

  it('leaves default rendering untouched', () => {
    expect(resolveIconRender(parseIconId('ion:beer-outline'), 'ionicons')).toEqual({ kind: 'ionicon', name: 'beer-outline' });
    expect(resolveIconRender(parseIconId('cart'), 'ionicons')).toEqual({ kind: 'ionicon', name: 'cart-outline' });
    expect(resolveIconRender(parseIconId('mystery'), 'ionicons')).toEqual({ kind: 'ionicon', name: 'help-circle-outline' });
    expect(resolveIconRender(parseIconId('cart'), 'ionicons', true)).toEqual({ kind: 'sf', name: 'cart' });
    expect(resolveIconRender(parseIconId('mystery'), 'ionicons', true)).toEqual({ kind: 'sf', name: 'mystery' });
  });

  it('draws covered glyphs with the set and falls back for the rest', () => {
    expect(resolveIconRender(parseIconId('ion:cart-outline'), 'pixel').kind).toBe('svg');
    expect(resolveIconRender(parseIconId('cart'), 'pixel').kind).toBe('svg');
    expect(resolveIconRender(parseIconId('cart'), 'pixel', true).kind).toBe('svg');
    expect(resolveIconRender(parseIconId('bag'), 'pixel')).toEqual({ kind: 'ionicon', name: 'bag-outline' });
    expect(resolveIconRender(parseIconId('bag'), 'pixel', true)).toEqual({ kind: 'sf', name: 'bag' });
    expect(resolveIconRender(parseIconId('mystery'), 'pixel')).toEqual({ kind: 'ionicon', name: 'help-circle-outline' });
  });
});

describe('theme icon validation', () => {
  it('requires a registered set', () => {
    expect(() => assertThemeDefinition(classicTheme)).not.toThrow();
    expect(() => assertThemeDefinition({ ...classicTheme, icons: { set: 'nope' } })).toThrow(/icons\.set/);
  });
});
