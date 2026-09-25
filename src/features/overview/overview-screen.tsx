import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedMoney } from '@/components/finance/animated-money';
import { CategoryDonut, SpendLineChart } from '@/components/finance/charts';
import { TransactionRow } from '@/components/finance/transaction-row';
import { ActionButton } from '@/components/ui/action-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { MonthSwitcher, type MonthDirection } from '@/components/ui/month-switcher';
import { MotionView } from '@/components/ui/motion';
import { PageHeading } from '@/components/ui/page-heading';
import { PageHero } from '@/components/ui/page-hero';
import { ProgressBar } from '@/components/ui/progress-bar';
import { floatingActionMetrics, ScreenContainer } from '@/components/ui/screen-container';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextButton } from '@/components/ui/text-button';
import { useScrollHide } from '@/components/ui/use-scroll-hide';
import { FRANKFURTER_UNSUPPORTED } from '@/data/exchange-rates/frankfurter';
import { useLocalization } from '@/localization/localization';
import { useExchangeRateService, useExchangeRateStatus } from '@/providers/exchange-rate-provider';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useScreenMetrics } from '@/theme/layout';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, tile as tileMetrics, toneColors } from '@/theme/tokens';
import { errorMessage, showError } from '@/utils/confirm';
import { endOfMonth, monthKey, monthLabel, startOfMonth } from '@/utils/date';
import { hapticSelection, hapticSuccess } from '@/utils/haptics';
import { formatMoney } from '@/utils/money';

export function OverviewScreen() {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const metrics = useScreenMetrics();
  const insets = useSafeAreaInsets();
  const { contentWidth } = metrics;
  const [month, setMonth] = useState(startOfMonth());
  // Which way the month content slides: forward months push in from the
  // right, previous months from the left.
  const [monthDirection, setMonthDirection] = useState<'left' | 'right'>('right');
  const [pendingUpcomingId, setPendingUpcomingId] = useState<string | null>(null);
  const { visibility: fabVisibility, onScroll } = useScrollHide();
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  const [togglingRates, setTogglingRates] = useState(false);

  const [insightMode, setInsightMode] = useState<'trend' | 'categories'>('trend');

  const turnOnAutomaticRates = async () => {
    if (togglingRates) return;
    setTogglingRates(true);
    try {
      await exchangeRateService.setEnabled(true);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that this may have just supplied one.
      await repository.generateRecurring();
    } catch (reason) {
      showError('Couldn’t turn on automatic rates', errorMessage(reason, 'Try again.'));
    } finally {
      setTogglingRates(false);
    }
  };

  const changeMonth = (next: string, direction: MonthDirection) => {
    setMonthDirection(direction);
    setMonth(next);
  };

  const resolveUpcoming = async (id: string, action: 'skip' | 'confirm') => {
    if (pendingUpcomingId) return;
    setPendingUpcomingId(id);
    try {
      await (action === 'skip' ? repository.skipUpcoming(id) : repository.confirmUpcoming(id));
      if (action === 'confirm') hapticSuccess();
      else hapticSelection();
    } catch (reason) {
      showError(action === 'skip' ? 'Couldn’t skip this item' : 'Couldn’t mark this item paid', errorMessage(reason, 'Try again.'));
    } finally {
      setPendingUpcomingId(null);
    }
  };
  const summary = useMemo(() => {
    // Repository reads are synchronous; these references make their external-store inputs explicit.
    void state.accounts;
    void state.budgetPeriods;
    void state.budgets;
    void state.categories;
    void state.exchangeRates;
    void state.settings;
    void state.transactions;
    return repository.getDashboard(startOfMonth(month), endOfMonth(month));
  }, [repository, month, state.accounts, state.budgetPeriods, state.budgets, state.categories, state.exchangeRates, state.settings, state.transactions]);
  const wide = contentWidth >= 900;
  const currency = state.settings.baseCurrency;
  const locale = state.settings.locale;
  const budgetProgress = summary.budgetLimitMinor > 0 ? summary.budgetSpentMinor / summary.budgetLimitMinor : summary.budgetSpentMinor > 0 ? 1 : 0;

  const insight = insightMode === 'trend'
    ? <SpendLineChart points={summary.dailySpend} currency={currency} locale={locale} />
    : <CategoryDonut items={summary.categorySpend} currency={currency} locale={locale} />;
  const seeMonth = () => router.push({ pathname: '/transactions', params: { month: monthKey(month) } });
  const missingCurrencies = summary.missingExchangeRates.map((rate) => rate.fromCurrency);
  const missingAllUnsupported = missingCurrencies.length > 0 && missingCurrencies.every((code) => FRANKFURTER_UNSUPPORTED.has(code));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" onScroll={onScroll} scrollEventThrottle={16} style={{ flex: 1, backgroundColor: theme.background }}>
        <ScreenContainer>
        {/* Native no longer draws its own copy of this heading: the section
            stack shows a real navigation header titled "Overview". Web keeps
            PageHeading, which is where the document's h1 lives. */}
        <PageHeading title="Overview" />

        <PageHero
          overline="Net worth"
          accessory={<MonthSwitcher value={month} direction={monthDirection} onChange={changeMonth} />}
          figure={(
            <View style={{ gap: space.xs }}>
              <AnimatedMoney minor={summary.netWorthMinor} currency={currency} locale={locale} variant="display" />
              {missingCurrencies.length ? (
                <View style={{ gap: space.xs }}>
                  <AppText literal variant="caption" style={{ color: theme.warning }}>
                    {`Excludes ${missingCurrencies.join(', ')} until an effective exchange rate is added.`}
                  </AppText>
                  <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                    {missingAllUnsupported ? (
                      <ActionButton
                        title="Add a manual rate"
                        variant="secondary"
                        onPress={() => router.push({ pathname: '/exchange-rate', params: { currency: missingCurrencies[0] } })}
                      />
                    ) : !rateStatus.enabled ? (
                      <>
                        <ActionButton title="Turn on automatic rates" busy={togglingRates} disabled={togglingRates} onPress={turnOnAutomaticRates} />
                        <ActionButton
                          title="Add manually"
                          variant="secondary"
                          onPress={() => router.push({ pathname: '/exchange-rate', params: { currency: missingCurrencies[0] } })}
                        />
                      </>
                    ) : rateStatus.lastError ? (
                      <ActionButton
                        title="Couldn’t fetch rates — Retry"
                        variant="secondary"
                        onPress={() => exchangeRateService.refreshLatest({ force: true }).catch(() => undefined)}
                      />
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          )}
          // Spent is deliberately not red. In the ledger an expense amount is
          // neutral text — red is reserved for "something is wrong", like a
          // budget gone over. Income keeps its green because money arriving
          // really is the exception worth marking.
          stats={([
            ['Income', summary.incomeMinor, theme.positive],
            ['Spent', summary.expenseMinor, theme.text],
            ['Net flow', summary.netFlowMinor, summary.netFlowMinor >= 0 ? theme.positive : theme.negative],
          ] as const).map(([label, amount, color]) => ({
            label,
            value: (
              <MotionView key={`${label}-${month}`} variant={monthDirection} exit>
                <AnimatedMoney
                  minor={amount}
                  currency={currency}
                  locale={locale}
                  compact={contentWidth < 520}
                  variant="headline"
                  numeric
                  style={{ color }}
                />
              </MotionView>
            ),
          }))}
        />

        <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xl, alignItems: 'flex-start' }}>
          <Card style={{ flex: wide ? 3 : undefined, alignSelf: 'stretch', gap: space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
              <SectionHeader title={insightMode === 'trend' ? 'Spending rhythm' : 'By category'} />
              <View style={{ minWidth: 220 }}>
                <SegmentedControl
                  label="Insight"
                  size="compact"
                  value={insightMode}
                  onChange={setInsightMode}
                  options={[
                    { value: 'trend', label: 'Trend' },
                    { value: 'categories', label: 'Categories' },
                  ]}
                />
              </View>
            </View>
            <MotionView key={`${insightMode}-${month}`} variant="fade" exit>
              {insight}
            </MotionView>
          </Card>

          <View style={{ flex: wide ? 2 : undefined, alignSelf: 'stretch', gap: space.xl }}>
            <Card style={{ gap: space.md }}>
              <SectionHeader title="Budget pulse" action="Open plan" onAction={() => router.push('/plan')} />
              {summary.budgetLimitMinor > 0 || summary.budgetSpentMinor > 0 ? (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, alignItems: 'baseline' }}>
                    <AnimatedMoney minor={summary.budgetSpentMinor} currency={currency} locale={locale} variant="money" numeric />
                    <AppText literal muted variant="caption">{`${t('of')} ${formatMoney(summary.budgetLimitMinor, currency, locale)}`}</AppText>
                  </View>
                  <ProgressBar label={t('Budget progress')} value={budgetProgress} color={budgetProgress > 1 ? theme.negative as string : undefined} />
                  <AppText variant="caption" muted>{budgetProgress > 1 ? 'Over budget — review the categories driving it.' : `${Math.max(0, Math.round((1 - budgetProgress) * 100))}% remains in this period.`}</AppText>
                </>
              ) : (
                <View style={{ gap: space.md, alignItems: 'flex-start' }}><AppText muted>Create a flexible monthly or custom budget to see your pace here.</AppText><ActionButton title="Create budget" variant="secondary" onPress={() => router.push('/budget')} /></View>
              )}
            </Card>
            <View style={{ gap: space.sm }}>
              <SectionHeader title="Accounts" action="Manage" onAction={() => router.push('/more')} />
              <Card variant="list" dividerInset={tileMetrics.size + space.md}>
                {summary.accountBalances.map(({ account, balanceMinor }) => {
                  const tile = toneColors(account.color, theme.staticSurface, theme.staticText, theme.mode === 'dark');
                  return (
                    <MotionView key={account.id} variant="fade" animateLayout exit>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60 }}>
                        <View style={{ width: tileMetrics.size, height: tileMetrics.size, borderRadius: radius.tile, borderCurve: 'continuous', backgroundColor: tile.container, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="wallet" color={tile.onContainer} size={tileMetrics.icon} /></View>
                        <View style={{ flex: 1, gap: space.xxs }}><AppText literal variant="label">{account.name}</AppText><AppText literal variant="caption" muted>{`${account.currency} · ${t(account.type)}`}</AppText></View>
                        <AnimatedMoney minor={balanceMinor} currency={account.currency} locale={locale} variant="label" numeric />
                      </View>
                    </MotionView>
                  );
                })}
              </Card>
            </View>
          </View>
        </View>

        {summary.upcomingTransactions.length ? (
          <View style={{ gap: space.sm }}>
            <SectionHeader title="Coming up" />
            <Card variant="list">
              {summary.upcomingTransactions.map((transaction) => (
                <MotionView key={transaction.id} variant="fade" animateLayout exit style={{ gap: space.xxs, paddingVertical: space.xs }}>
                  <TransactionRow transaction={transaction} compact returnTo="/overview" />
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>
                    <TextButton title="Skip" tone="muted" disabled={pendingUpcomingId !== null} onPress={() => resolveUpcoming(transaction.id, 'skip')} />
                    <TextButton title="Mark paid" disabled={pendingUpcomingId !== null} onPress={() => resolveUpcoming(transaction.id, 'confirm')} />
                  </View>
                </MotionView>
              ))}
            </Card>
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <SectionHeader title="Recent activity" action="See all" onAction={seeMonth} />
          {summary.recentTransactions.length ? (
            <Card variant="list">
              {summary.recentTransactions.map((transaction) => (
                <MotionView key={transaction.id} variant="fade" animateLayout exit>
                  <TransactionRow transaction={transaction} returnTo="/overview" />
                </MotionView>
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState
                compact
                icon="arrow.left.arrow.right"
                title={state.transactions.length ? `No activity in ${monthLabel(month, locale)}` : 'Your ledger is ready'}
                body={state.transactions.length ? 'Choose another month or open the full transaction list.' : 'Add the first transaction and Qashy will turn it into useful context.'}>
                {state.transactions.length ? (
                  <ActionButton title="See all transactions" variant="secondary" onPress={seeMonth} />
                ) : (
                  <ActionButton title="Add transaction" icon="plus" onPress={() => router.push({ pathname: '/transaction', params: { returnTo: '/overview' } })} />
                )}
              </EmptyState>
            </Card>
          )}
        </View>
        </ScreenContainer>
      </ScrollView>
      <FloatingActionButton
        label="Add transaction"
        visibility={fabVisibility}
        onPress={() => router.push({ pathname: '/transaction', params: { returnTo: '/overview' } })}
        style={floatingActionMetrics(metrics, insets)}
      />
    </View>
  );
}
