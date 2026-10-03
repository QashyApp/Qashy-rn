import * as fs from 'fs';
import * as path from 'path';

import { ICON_CATALOG } from '@/theme/icon-catalog';
import { IONICON_BY_SF_NAME, iconSetCoverage, resolveIconRender } from '@/theme/icon-sets';
import { FONT_REGISTRY, scriptsCovered } from '@/theme/fonts';
import { materialStyle, type Material } from '@/theme/materials';
import { shadowBlurs } from '@/theme/shadow';
import { accentTokens } from '@/theme/theme';
import { BUILT_IN_THEMES } from '@/theme/themes/registry';
import { assertThemeDefinition } from '@/theme/themes/validate';
import { contrastRatio, readableTextColor } from '@/theme/tokens';

/**
 * Runs over every registered theme, so a new built-in theme (or a regression in an existing one)
 * fails here. The rules are floors: a theme may exceed them (high-contrast does, by design).
 */

const SCHEMES = ['light', 'dark'] as const;
const MATERIALS: readonly Material[] = ['card', 'raised', 'sunken', 'control', 'controlPressed', 'accent', 'accentPressed', 'selected', 'overlay', 'well'];

const CATALOG_GLYPHS = ICON_CATALOG.map((icon) => `${icon.glyph}-outline`);
const SF_GLYPHS = Array.from(new Set(Object.values(IONICON_BY_SF_NAME)));

const THEMES_DIR = path.resolve(__dirname, '../themes');
const THEME_SOURCES = fs
  .readdirSync(THEMES_DIR)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file, source: stripComments(fs.readFileSync(path.join(THEMES_DIR, file), 'utf8')) }));

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))('theme conformance: %s', (_id, theme) => {
  it('passes the structural validator and defines both schemes', () => {
    expect(() => assertThemeDefinition(theme)).not.toThrow();
    for (const scheme of SCHEMES) {
      expect(theme.palette[scheme]).toBeDefined();
      expect(theme.shadows[scheme]).toBeDefined();
    }
  });

  describe.each(SCHEMES)('%s contrast', (scheme) => {
    const dark = scheme === 'dark';
    const palette = theme.palette[scheme];

    it('text and muted text are readable on the surfaces they sit on', () => {
      expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.textMuted, palette.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.text, palette.surfaceElevated)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
    });

    it('status colors clear 3:1 on the surface', () => {
      for (const key of ['positive', 'negative', 'warning'] as const) {
        expect(contrastRatio(palette[key], palette.surface)).toBeGreaterThanOrEqual(3);
      }
    });

    it('the resolved accent carries readable on-accent text', () => {
      const tokens = accentTokens(theme.accent.default, dark, theme);
      expect(tokens.onAccent).toBe(readableTextColor(tokens.staticAccent));
      expect(contrastRatio(readableTextColor(tokens.staticAccent), tokens.staticAccent)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('keeps touch targets and scales sane', () => {
    expect(theme.tile.size).toBeGreaterThanOrEqual(32);
    for (const scale of [theme.space, theme.radius, theme.tile, theme.iconSize]) {
      for (const value of Object.values(scale)) expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('has a glyph source for every shipped locale', () => {
    const covered = scriptsCovered(theme.type);
    expect(covered.has('latin')).toBe(true);
    expect(covered.has('hebrew')).toBe(true);
    for (const id of [theme.type.text.family, ...theme.type.text.fallbacks, theme.type.numeric.family, ...theme.type.numeric.fallbacks]) {
      expect(FONT_REGISTRY[id]).toBeDefined();
    }
  });

  it('uses a press behavior that actually moves the control', () => {
    if (theme.motion.press === 'translate') expect(theme.motion.pressTranslate).toBeGreaterThanOrEqual(1);
    else expect(theme.motion.pressScale).toBeLessThan(1);
  });

  it('keeps every shadow hard-edged for the bevel engine, in every material', () => {
    if (theme.material.engine !== 'bevel') return;
    for (const scheme of SCHEMES) {
      const tokens = accentTokens(theme.accent.default, scheme === 'dark', theme);
      for (const material of MATERIALS) {
        const shadow = materialStyle(tokens, material).boxShadow;
        if (typeof shadow === 'string') {
          expect({ material, blurs: shadowBlurs(shadow).filter((blur) => blur > 0) }).toEqual({ material, blurs: [] });
        }
      }
    }
  });

  it('lists icon-set gaps and every gap falls back to Ionicons', () => {
    for (const glyphs of [CATALOG_GLYPHS, SF_GLYPHS]) {
      const { covered, missing } = iconSetCoverage(theme.icons.set, glyphs);
      expect(covered.length + missing.length).toBe(glyphs.length);
      for (const glyph of missing) {
        expect(resolveIconRender({ kind: 'ion', glyph }, theme.icons.set)).toEqual({ kind: 'ionicon', name: glyph });
      }
    }
  });
});

describe('theme source hygiene', () => {
  it.each(THEME_SOURCES.map(({ file, source }) => [file, source] as const))('%s has no clock, network or foreign assets', (_file, source) => {
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
