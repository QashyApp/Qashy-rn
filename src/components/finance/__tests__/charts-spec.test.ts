import { slicePattern } from '@/components/finance/slice-pattern';
import { classicTheme } from '@/theme/themes/classic';
import { assertThemeDefinition } from '@/theme/themes/validate';
import { CATEGORY_PALETTE, toneColors } from '@/theme/tokens';
import type { ChartSpec, ThemeDefinition } from '@/theme/themes/types';

const withCharts = (over: Partial<ChartSpec>): ThemeDefinition => ({
  ...classicTheme,
  id: 'chart-test',
  name: 'Chart test',
  charts: { ...classicTheme.charts, ...over },
});

describe('classic chart spec', () => {
  it('equals the values charts.tsx and sparkline.tsx hard-coded before theming', () => {
    const { charts } = classicTheme;
    expect(charts.lineWidth).toBe(2.5);
    expect(charts.sparklineWidth).toBe(2);
    expect(charts.lineCap).toBe('round');
    expect(charts.donutThickness).toBe(16);
    expect(charts.gridDash).toBe('4 4');
    expect(charts.patterns).toBe(false);
    expect(charts.categoryPalette).toBe(CATEGORY_PALETTE);
    expect(charts.tone).toEqual({ containerMix: { light: 0.86, dark: 0.78 }, minContrast: 3 });
  });
});

describe('slicePattern', () => {
  it('never repeats between adjacent slices, including across the wrap', () => {
    for (let index = 0; index < 8; index += 1) {
      expect(slicePattern(index)).not.toBe(slicePattern(index + 1));
    }
    expect(slicePattern(0)).not.toBe(slicePattern(3));
  });

  it('cycles deterministically', () => {
    expect(slicePattern(5)).toBe(slicePattern(1));
    expect(slicePattern(-1)).toBe(slicePattern(3));
  });
});

describe('toneColors', () => {
  const args = ['#E5484D', '#FFFFFF', '#111111'] as const;

  it('defaults to the classic recipe', () => {
    for (const dark of [false, true]) {
      expect(toneColors(...args, dark)).toEqual(toneColors(...args, dark, classicTheme.charts.tone));
    }
  });

  it('follows a different tone', () => {
    const stronger = { containerMix: { light: 0.4, dark: 0.4 }, minContrast: 3 };
    expect(toneColors(...args, false, stronger).container).not.toBe(toneColors(...args, false).container);
  });
});

describe('assertCharts', () => {
  it('accepts classic and a solid grid', () => {
    expect(() => assertThemeDefinition(withCharts({}))).not.toThrow();
    expect(() => assertThemeDefinition(withCharts({ gridDash: '', patterns: true, lineCap: 'butt' }))).not.toThrow();
  });

  it.each([
    ['lineWidth', { lineWidth: 0 }],
    ['donutThickness', { donutThickness: -1 }],
    ['lineCap', { lineCap: 'bevel' as ChartSpec['lineCap'] }],
    ['gridDash', { gridDash: '4,4' }],
    ['patterns', { patterns: 'yes' as unknown as boolean }],
    ['categoryPalette', { categoryPalette: CATEGORY_PALETTE.slice(0, 3) }],
    ['categoryPalette', { categoryPalette: [...CATEGORY_PALETTE.slice(0, 5), 'red'] }],
    ['containerMix', { tone: { containerMix: { light: 1, dark: 0.5 }, minContrast: 3 } }],
    ['minContrast', { tone: { containerMix: { light: 0.5, dark: 0.5 }, minContrast: 2 } }],
  ])('rejects a bad %s', (path, over) => {
    expect(() => assertThemeDefinition(withCharts(over))).toThrow(new RegExp(`charts\.(tone\.)?${path}`));
  });
});
