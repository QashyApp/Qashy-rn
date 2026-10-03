import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { AnimatedMoney } from '@/components/finance/animated-money';
import { ActionButton } from '@/components/ui/action-button';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ChoiceListField } from '@/components/ui/choice-list-field';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SectionHeader } from '@/components/ui/section-header';
import { useLocalization } from '@/localization/localization';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useQashyTheme } from '@/theme/theme';
import { todayLocal } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import type { WidgetConfigSheetProps, WidgetProps } from '@/features/overview/widgets/types';
import { useDashboard } from '@/features/overview/widgets/use-dashboard';

export function BudgetPulseWidget({ card, month }: WidgetProps) {
  const theme = useQashyTheme();
  const { space } = theme;
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { t } = useLocalization();
  const summary = useDashboard(month);
  const currency = state.settings.baseCurrency;
  const locale = state.settings.locale;
  const budgetId = typeof card.config.budgetId === 'string' ? card.config.budgetId : undefined;

  const today = todayLocal();
  const budgetStatuses = useMemo(
    () => repository.getBudgetStatuses(today, { includeInactiveCustom: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repository reads these slices internally
    [repository, today, state.budgets, state.budgetPeriods, state.budgetAdjustments, state.transactions, state.categories],
  );
  const selected = budgetId ? budgetStatuses.find((status) => status.budget.id === budgetId) : undefined;

  if (budgetId && selected) {
    const ratio = selected.effectiveLimitMinor > 0 ? selected.spentMinor / selected.effectiveLimitMinor : selected.spentMinor > 0 ? 1 : 0;
    return (
      <Card style={{ gap: space.md }}>
        <SectionHeader title="Budget pulse" action="Open plan" onAction={() => router.push('/plan')} />
        <AppText literal variant="label">{selected.budget.name}</AppText>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, alignItems: 'baseline' }}>
          <AnimatedMoney minor={selected.spentMinor} currency={currency} locale={locale} variant="money" numeric />
          <AppText literal muted variant="caption">{`${t('of')} ${formatMoney(selected.effectiveLimitMinor, currency, locale)}`}</AppText>
        </View>
        <ProgressBar label={t('Budget progress')} value={ratio} color={ratio > 1 ? (theme.negative as string) : undefined} />
        {ratio > 1 ? <AppText variant="caption" style={{ color: theme.negative }}>Over budget</AppText> : null}
      </Card>
    );
  }

  if (budgetId && !selected) {
    return (
      <Card style={{ gap: space.md }}>
        <SectionHeader title="Budget pulse" action="Open plan" onAction={() => router.push('/plan')} />
        <AppText muted>This budget is no longer available.</AppText>
      </Card>
    );
  }

  const budgetProgress = summary.budgetLimitMinor > 0 ? summary.budgetSpentMinor / summary.budgetLimitMinor : summary.budgetSpentMinor > 0 ? 1 : 0;
  return (
    <Card style={{ gap: space.md }}>
      <SectionHeader title="Budget pulse" action="Open plan" onAction={() => router.push('/plan')} />
      {summary.budgetLimitMinor > 0 || summary.budgetSpentMinor > 0 ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, alignItems: 'baseline' }}>
            <AnimatedMoney minor={summary.budgetSpentMinor} currency={currency} locale={locale} variant="money" numeric />
            <AppText literal muted variant="caption">{`${t('of')} ${formatMoney(summary.budgetLimitMinor, currency, locale)}`}</AppText>
          </View>
          <ProgressBar label={t('Budget progress')} value={budgetProgress} color={budgetProgress > 1 ? (theme.negative as string) : undefined} />
          <AppText variant="caption" muted>{budgetProgress > 1 ? 'Over budget — review the categories driving it.' : `${Math.max(0, Math.round((1 - budgetProgress) * 100))}% remains in this period.`}</AppText>
        </>
      ) : (
        <View style={{ gap: space.md, alignItems: 'flex-start' }}>
          <AppText muted>Create a flexible monthly or custom budget to see your pace here.</AppText>
          <ActionButton title="Create budget" variant="secondary" onPress={() => router.push('/budget')} />
        </View>
      )}
    </Card>
  );
}

export function BudgetPulseConfigSheet({ card, onConfigure }: WidgetConfigSheetProps) {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const today = todayLocal();
  const budgetStatuses = useMemo(
    () => repository.getBudgetStatuses(today, { includeInactiveCustom: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repository reads these slices internally
    [repository, today, state.budgets, state.budgetPeriods, state.budgetAdjustments, state.transactions, state.categories],
  );
  const budgetId = typeof card.config.budgetId === 'string' ? card.config.budgetId : '';

  return (
    <ChoiceListField
      label="Budget"
      value={budgetId}
      literalOptions
      onChange={(value) => onConfigure({ budgetId: value || null })}
      options={[
        { value: '', label: 'All budgets' },
        ...budgetStatuses.map((status) => ({ value: status.budget.id, label: status.budget.name })),
      ]}
    />
  );
}
