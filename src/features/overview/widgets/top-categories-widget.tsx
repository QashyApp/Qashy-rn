import { View } from 'react-native';

import { AnimatedMoney } from '@/components/finance/animated-money';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SectionHeader } from '@/components/ui/section-header';
import { useLocalization } from '@/localization/localization';
import { useFinanceState } from '@/providers/finance-provider';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, tile as tileMetrics, toneColors } from '@/theme/tokens';
import type { WidgetProps } from '@/features/overview/widgets/types';
import { useDashboard } from '@/features/overview/widgets/use-dashboard';

const MAX_CATEGORIES_SHOWN = 5;

export function TopCategoriesWidget({ month }: WidgetProps) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const state = useFinanceState();
  const summary = useDashboard(month);
  const locale = state.settings.locale;
  const currency = state.settings.baseCurrency;

  const spendItems = summary.categorySpend.filter((item) => item.amountMinor > 0);
  const totalMinor = spendItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const top = [...spendItems].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, MAX_CATEGORIES_SHOWN);

  if (!top.length) {
    return (
      <Card>
        <SectionHeader title="Top categories" />
        <EmptyState compact icon="chart.pie" title="No spending yet" body="Categorized expenses this month will rank here." />
      </Card>
    );
  }

  return (
    <Card style={{ gap: space.lg }}>
      <SectionHeader title="Top categories" />
      <View style={{ gap: space.md }}>
        {top.map((item, index) => {
          const category = item.category;
          const share = totalMinor > 0 ? item.amountMinor / totalMinor : 0;
          const percent = Math.round(share * 100);
          const tile = toneColors(category?.color ?? theme.staticAccent, theme.staticSurface, theme.staticText, theme.mode === 'dark');
          const name = category?.name ?? 'Uncategorized';
          const translatedName = category ? category.name : t('Uncategorized');
          return (
            <View key={category?.id ?? `uncategorized-${index}`} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <View style={{ width: tileMetrics.size, height: tileMetrics.size, borderRadius: radius.tile, borderCurve: 'continuous', backgroundColor: tile.container, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={category?.icon ?? 'chart.pie'} color={tile.onContainer} size={tileMetrics.icon} />
                </View>
                <AppText literal={Boolean(category)} variant="label" style={{ flex: 1 }} numberOfLines={1}>{name}</AppText>
                <View style={{ alignItems: 'flex-end', gap: space.xxs }}>
                  <AnimatedMoney minor={item.amountMinor} currency={currency} locale={locale} variant="label" numeric />
                  {/* The bar's color never carries the share on its own — this is the visible text that does. */}
                  <AppText literal variant="caption" muted numeric>{`${percent}%`}</AppText>
                </View>
              </View>
              <ProgressBar label={t(`${translatedName}: ${percent}% of this month's spending`)} value={share} color={category?.color} size="thin" />
            </View>
          );
        })}
      </View>
    </Card>
  );
}
