import { render } from '@testing-library/react-native';

import { CategoryDonut } from '@/components/finance/charts';
import { classicTheme } from '@/theme/themes/classic';
import type { DashboardSummary } from '@/domain/models';

let mockPatterns = false;

jest.mock('@/theme/theme', () => ({
  useQashyTheme: () => ({
    ...(({ space, radius, tile, iconSize, motion, type }) => ({ space, radius, tile, iconSize, motion, type }))(
      jest.requireActual('@/theme/themes/classic').classicTheme,
    ),
    charts: { ...jest.requireActual('@/theme/themes/classic').classicTheme.charts, patterns: mockPatterns },
    text: '#111111',
    textMuted: '#666666',
    surfaceSunken: '#f2f2f2',
    staticSurface: '#ffffff',
    radius: jest.requireActual('@/theme/themes/classic').classicTheme.radius,
  }),
}));

jest.mock('@/localization/localization', () => ({
  useLocalization: () => ({ t: (message: string) => message, isRtl: false, language: 'en', locale: 'en-US' }),
}));

const items = [
  { category: { id: 'a', name: 'Food', color: '#E5484D' }, amountMinor: 5000 },
  { category: { id: 'b', name: 'Rent', color: '#3E63DD' }, amountMinor: 3000 },
] as unknown as DashboardSummary['categorySpend'];

const countByType = (node: unknown, type: string): number => {
  const json = node as { type?: string; children?: unknown[] } | null;
  if (!json || typeof json !== 'object') return 0;
  return (json.type === type ? 1 : 0) + (json.children ?? []).reduce<number>((sum, child) => sum + countByType(child, type), 0);
};

describe('CategoryDonut patterns', () => {
  it('uses the classic spec with patterns off, so the ring has no pattern overlays', async () => {
    expect(classicTheme.charts.patterns).toBe(false);
    mockPatterns = false;
    const view = await render(<CategoryDonut items={items} currency="USD" locale="en-US" />);
    expect(countByType(view.toJSON(), 'RNSVGPattern')).toBe(0);
  });

  it('adds one pattern per slice when the theme turns patterns on', async () => {
    mockPatterns = true;
    const view = await render(<CategoryDonut items={items} currency="USD" locale="en-US" />);
    expect(countByType(view.toJSON(), 'RNSVGPattern')).toBe(2);
  });
});
