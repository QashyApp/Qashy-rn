import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedMoney } from '@/components/finance/animated-money';
import { Sparkline } from '@/components/finance/sparkline';
import { ActionButton } from '@/components/ui/action-button';
import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { MonthSwitcher, type MonthDirection } from '@/components/ui/month-switcher';
import { MotionView } from '@/components/ui/motion';
import { PageHeading } from '@/components/ui/page-heading';
import { PageHero } from '@/components/ui/page-hero';
import { floatingActionMetrics, ScreenContainer } from '@/components/ui/screen-container';
import { TextButton } from '@/components/ui/text-button';
import { UndoBar } from '@/components/ui/undo-bar';
import { useScrollHide } from '@/components/ui/use-scroll-hide';
import { FRANKFURTER_UNSUPPORTED } from '@/data/exchange-rates/frankfurter';
import { AddCardWell } from '@/features/overview/card-gallery-screen';
import { EditableCardFrame } from '@/features/overview/edit/editable-card-frame';
import {
  DEFAULT_OVERVIEW_LAYOUT,
  WIDGET_RULES,
  type OverviewCard,
  type OverviewLayoutAction,
} from '@/features/overview/layout/overview-layout';
import { useOverviewLayout } from '@/features/overview/layout/use-overview-layout';
import { GRID_BREAKPOINT, packOverviewRows } from '@/features/overview/widgets/grid';
import { WIDGET_REGISTRY } from '@/features/overview/widgets/registry';
import { useLocalization } from '@/localization/localization';
import { useExchangeRateService, useExchangeRateStatus } from '@/providers/exchange-rate-provider';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useScreenMetrics } from '@/theme/layout';
import { useQashyTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { errorMessage, showError } from '@/utils/confirm';
import { endOfMonth, startOfMonth } from '@/utils/date';
import { hapticImpactLight } from '@/utils/haptics';
import { amountTone } from '@/utils/labels';
import { formatMoney } from '@/utils/money';

interface UndoState {
  readonly card: OverviewCard;
  readonly index: number;
}

function nextSizeFor(card: OverviewCard) {
  const sizes = WIDGET_RULES[card.type].sizes;
  const currentIndex = sizes.indexOf(card.size);
  const nextIndex = (currentIndex + 1) % sizes.length;
  return sizes[nextIndex];
}

export function OverviewScreen() {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const metrics = useScreenMetrics();
  const insets = useSafeAreaInsets();
  const { contentWidth } = metrics;
  // Single vs. multi-column is a product decision keyed off `contentWidth` (the room the web
  // shell says a screen has beside the rail/sidebar) — that's the number the original design's
  // breakpoint meant. But `contentWidth` can be wider than the box actually rendered inside it
  // (`ScreenContainer` caps its own width below a 1200px window), so pixel widths must come from
  // the card-stack container's own measured width instead, or cards overflow the real box.
  // `gridWidth` starts at 0 so the very first render (before onLayout fires) uses full-width
  // single-column cards instead of flashing an overflowing pixel width.
  const [gridWidth, setGridWidth] = useState(0);
  const onGridLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setGridWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
  };
  const [month, setMonth] = useState(startOfMonth());
  // Which way the month content slides: forward months push in from the
  // right, previous months from the left.
  const [monthDirection, setMonthDirection] = useState<'left' | 'right'>('right');
  const { visibility: fabVisibility, onScroll } = useScrollHide();
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  const [togglingRates, setTogglingRates] = useState(false);

  const { layout, status, dispatch } = useOverviewLayout();
  const cards = status === 'loading' ? DEFAULT_OVERVIEW_LAYOUT.cards : layout.cards;
  const [editing, setEditing] = useState(false);
  const [configOpenId, setConfigOpenId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const cardLayoutsRef = useRef(new Map<string, { y: number; height: number }>());

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

  const summary = useMemo(() => {
    void state.accounts;
    void state.budgetPeriods;
    void state.budgets;
    void state.categories;
    void state.exchangeRates;
    void state.settings;
    void state.transactions;
    return repository.getDashboard(startOfMonth(month), endOfMonth(month));
  }, [repository, month, state.accounts, state.budgetPeriods, state.budgets, state.categories, state.exchangeRates, state.settings, state.transactions]);

  const currency = state.settings.baseCurrency;
  const locale = state.settings.locale;
  const missingCurrencies = summary.missingExchangeRates.map((rate) => rate.fromCurrency);
  const missingAllUnsupported = missingCurrencies.length > 0 && missingCurrencies.every((code) => FRANKFURTER_UNSUPPORTED.has(code));

  // Zero is neutral: only a real gain is green and only a real loss is red.
  const toneColor = (minor: number) => {
    const tone = amountTone(minor);
    return tone === 'positive' ? theme.positive : tone === 'negative' ? theme.negative : theme.text;
  };

  // The net-worth figure is a single line at any width. `adjustsFontSizeToFit` only exists on
  // native; react-native-web ignores it, so the size is also derived from the measured column
  // width and the formatted length (a display digit is ~0.6em wide, the currency/fraction runs
  // are smaller, so this errs slightly small rather than wrapping).
  const [netWorthWidth, setNetWorthWidth] = useState(0);
  const NET_WORTH_BASE_SIZE = 40;
  const netWorthChars = formatMoney(summary.netWorthMinor, currency, locale).length;
  const netWorthScale = netWorthWidth > 0
    ? Math.max(0.4, Math.min(1, netWorthWidth / (netWorthChars * 0.6 * NET_WORTH_BASE_SIZE)))
    : 1;

  const cumulativeSpend = useMemo(
    () => summary.dailySpend.reduce<number[]>((running, day) => {
      const previous = running.length ? running[running.length - 1] : 0;
      running.push(previous + day.amountMinor);
      return running;
    }, []),
    [summary.dailySpend],
  );

  // The column-count decision is `contentWidth`'s (the original design's breakpoint), kept
  // separate from the pixel budget cards are packed into (the measured container). A row's
  // `flexDirection` and the edit toolbar's size-cycle control follow the same `contentWidth`
  // decision so all three never disagree about whether this is a "wide" layout.
  const multiColumn = contentWidth >= GRID_BREAKPOINT;
  const rows = useMemo(
    () => (gridWidth > 0 ? packOverviewRows(cards, gridWidth, space.xl, { multiColumn }) : []),
    [cards, gridWidth, multiColumn],
  );

  const dispatchGuarded = async (action: OverviewLayoutAction, failureTitle: string) => {
    try {
      await dispatch(action);
    } catch (reason) {
      showError(failureTitle, errorMessage(reason, 'Try again.'));
    }
  };

  const moveCard = (id: string, delta: 1 | -1) => {
    void dispatchGuarded({ type: 'moveBy', id, delta }, 'Couldn’t update your overview');
  };

  const resizeCard = (card: OverviewCard) => {
    void dispatchGuarded({ type: 'resize', id: card.id, size: nextSizeFor(card) }, 'Couldn’t update your overview');
  };

  const configureCard = (id: string, config: Record<string, unknown>) => {
    void dispatchGuarded({ type: 'configure', id, config }, 'Couldn’t update your overview');
  };

  const removeCard = (card: OverviewCard) => {
    const index = cards.findIndex((existing) => existing.id === card.id);
    void dispatchGuarded({ type: 'remove', id: card.id }, 'Couldn’t update your overview').then(() => {
      setUndo({ card, index });
    });
  };

  const undoRemove = () => {
    if (!undo) return;
    void dispatchGuarded(
      { type: 'add', card: { id: undo.card.id, type: undo.card.type, size: undo.card.size, config: undo.card.config }, index: undo.index },
      'Couldn’t restore this card',
    );
    setUndo(null);
  };

  const handleCardLayout = (id: string) => (event: LayoutChangeEvent) => {
    cardLayoutsRef.current.set(id, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height });
  };

  const handleDragEnd = (card: OverviewCard, offsetY: number) => {
    const fromIndex = cards.findIndex((existing) => existing.id === card.id);
    const own = cardLayoutsRef.current.get(card.id);
    if (fromIndex === -1 || !own) return;
    const draggedMid = own.y + own.height / 2 + offsetY;
    let targetIndex = 0;
    cards.forEach((existing) => {
      if (existing.id === card.id) return;
      const layoutInfo = cardLayoutsRef.current.get(existing.id);
      if (!layoutInfo) return;
      if (layoutInfo.y + layoutInfo.height / 2 < draggedMid) targetIndex += 1;
    });
    if (targetIndex === fromIndex) return;
    void dispatchGuarded({ type: 'move', id: card.id, toIndex: targetIndex }, 'Couldn’t update your overview');
  };

  const enterEditMode = () => {
    hapticImpactLight();
    setEditing(true);
  };

  const exitEditMode = () => {
    setEditing(false);
    setConfigOpenId(null);
  };

  const renderWidget = (card: OverviewCard, size = card.size) => {
    const definition = WIDGET_REGISTRY[card.type];
    if (!definition) return null;
    const Component = definition.Component;
    return <Component card={card} month={month} monthDirection={monthDirection} size={size} editing={editing} />;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" onScroll={onScroll} scrollEventThrottle={16} style={{ flex: 1, backgroundColor: theme.background }}>
        <ScreenContainer>
          {/* Native no longer draws its own copy of this heading: the section
              stack shows a real navigation header titled "Overview". Web keeps
              PageHeading, which is where the document's h1 lives. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
            <View style={{ flex: 1 }}><PageHeading title="Overview" /></View>
            {editing ? (
              <TextButton title="Done" icon="checkmark" onPress={exitEditMode} />
            ) : (
              <TextButton title="Customize" icon="gear" onPress={enterEditMode} />
            )}
          </View>

          <PageHero
            overline="Net worth"
            accessory={<MonthSwitcher value={month} direction={monthDirection} onChange={changeMonth} />}
            figure={(
              <View
                style={{ gap: space.xs }}
                onLayout={(event: LayoutChangeEvent) => {
                  const next = Math.floor(event.nativeEvent.layout.width);
                  setNetWorthWidth((current) => (current === next ? current : next));
                }}>
                <AnimatedMoney
                  minor={summary.netWorthMinor}
                  currency={currency}
                  locale={locale}
                  variant="display"
                  scale={netWorthScale}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                  style={{ flexShrink: 1, ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as object) : null) }}
                />
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
            stats={([
              ['Income', summary.incomeMinor, toneColor(summary.incomeMinor)],
              ['Spent', summary.expenseMinor, theme.text],
              ['Net flow', summary.netFlowMinor, toneColor(summary.netFlowMinor)],
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
            footer={cumulativeSpend.some((value) => value > 0) ? (
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }}>
                  <AppText variant="caption" muted>Cumulative spending</AppText>
                  <AnimatedMoney
                    minor={cumulativeSpend[cumulativeSpend.length - 1]}
                    currency={currency}
                    locale={locale}
                    compact={contentWidth < 520}
                    variant="label"
                    numeric
                  />
                </View>
                <Sparkline values={cumulativeSpend} label={t('Cumulative spending')} />
              </View>
            ) : undefined}
          />

          {!editing ? (
            cards.length ? (
              <View style={{ gap: space.xl }} onLayout={onGridLayout}>
                {gridWidth === 0 ? (
                  cards.map((card) => (
                    <MotionView key={card.id} animateLayout style={{ width: '100%' }}>
                      {Platform.OS === 'web' ? (
                        renderWidget(card)
                      ) : (
                        <Pressable delayLongPress={450} onLongPress={enterEditMode} style={{ width: '100%' }}>
                          {renderWidget(card)}
                        </Pressable>
                      )}
                    </MotionView>
                  ))
                ) : (
                  rows.map((row, rowIndex) => (
                    <View
                      key={rowIndex}
                      style={multiColumn
                        ? { flexDirection: 'row', gap: space.xl, alignItems: 'flex-start', flexWrap: 'wrap' }
                        : { gap: space.xl }}>
                      {row.cards.map(({ card, width }) => (
                        <MotionView key={card.id} animateLayout style={{ width }}>
                          {Platform.OS === 'web' ? (
                            renderWidget(card)
                          ) : (
                            <Pressable delayLongPress={450} onLongPress={enterEditMode} style={{ width: '100%' }}>
                              {renderWidget(card)}
                            </Pressable>
                          )}
                        </MotionView>
                      ))}
                    </View>
                  ))
                )}
              </View>
            ) : (
              <EmptyState
                icon="plus.circle"
                title="Your overview is empty"
                body="Add cards to see budgets, goals and activity here.">
                <ActionButton title="Add cards" icon="plus" onPress={() => router.push('/overview-cards')} />
              </EmptyState>
            )
          ) : (
            <View style={{ gap: space.lg }}>
              {cards.map((card, index) => {
                const definition = WIDGET_REGISTRY[card.type];
                if (!definition) return null;
                const rule = WIDGET_RULES[card.type];
                const showSizeControl = rule.sizes.length > 1 && multiColumn;
                const hasConfigSheet = Boolean(definition.ConfigSheet);
                const ConfigSheetComponent = definition.ConfigSheet;
                return (
                  <EditableCardFrame
                    key={card.id}
                    title={t(definition.title)}
                    index={index}
                    total={cards.length}
                    sizes={rule.sizes}
                    showSizeControl={showSizeControl}
                    hasConfigSheet={hasConfigSheet}
                    configOpen={configOpenId === card.id}
                    onToggleConfig={() => setConfigOpenId((current) => (current === card.id ? null : card.id))}
                    onMoveUp={() => moveCard(card.id, -1)}
                    onMoveDown={() => moveCard(card.id, 1)}
                    onCycleSize={() => resizeCard(card)}
                    onRemove={() => removeCard(card)}
                    onDragEnd={(offsetY) => handleDragEnd(card, offsetY)}
                    onLayout={handleCardLayout(card.id)}
                    configSheet={ConfigSheetComponent ? (
                      <ConfigSheetComponent card={card} onConfigure={(config) => configureCard(card.id, config)} />
                    ) : undefined}>
                    {renderWidget(card)}
                  </EditableCardFrame>
                );
              })}
              <AddCardWell onPress={() => router.push('/overview-cards')} />
            </View>
          )}
        </ScreenContainer>
      </ScrollView>
      {undo ? (
        <UndoBar
          message={`${WIDGET_REGISTRY[undo.card.type]?.title ?? ''} removed`}
          onAction={undoRemove}
          onDismiss={() => setUndo(null)}
          style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + space.xxl + 64 }}
        />
      ) : null}
      <FloatingActionButton
        label="Add transaction"
        visibility={fabVisibility}
        onPress={() => router.push({ pathname: '/transaction', params: { returnTo: '/overview' } })}
        style={floatingActionMetrics(metrics, insets)}
      />
    </View>
  );
}
