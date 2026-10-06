import { router } from "expo-router";
import { memo, useMemo, useState, type Ref } from "react";
import type { SharedValue } from "react-native-reanimated";
import {
  Platform,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { Sparkline } from "@/components/finance/sparkline";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import {
  MonthSwitcher,
  type MonthDirection,
} from "@/components/ui/month-switcher";
import { MonthContentFade } from "@/components/ui/month-content-fade";
import { PAGER_SCROLLER_STYLE } from "@/components/ui/month-pager";
import { MotionView } from "@/components/ui/motion";
import { PageHeading } from "@/components/ui/page-heading";
import { PageHero } from "@/components/ui/page-hero";
import { ScreenContainer } from "@/components/ui/screen-container";
import { TextButton } from "@/components/ui/text-button";
import { FRANKFURTER_UNSUPPORTED } from "@/data/exchange-rates/frankfurter";
import { AddCardWell } from "@/features/overview/card-gallery-screen";
import { EditableCardFrame } from "@/features/overview/edit/editable-card-frame";
import {
  WIDGET_RULES,
  type OverviewCard,
} from "@/features/overview/layout/overview-layout";
import {
  GRID_BREAKPOINT,
  packOverviewRows,
} from "@/features/overview/widgets/grid";
import { WIDGET_REGISTRY } from "@/features/overview/widgets/registry";
import { useDashboard } from "@/features/overview/widgets/use-dashboard";
import { useLocalization } from "@/localization/localization";
import {
  useExchangeRateService,
  useExchangeRateStatus,
} from "@/providers/exchange-rate-provider";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useScreenMetrics } from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { amountTone } from "@/utils/labels";
import { formatMoney } from "@/utils/money";

export interface OverviewMonthPageProps {
  month: string;
  /** Only the current page scrolls and reports scroll offsets to the floating button. */
  isCurrent: boolean;
  /** The month pager's drag, which slides the month title. */
  dragProgress?: SharedValue<number>;
  editing: boolean;
  cards: readonly OverviewCard[];
  configOpenId: string | null;
  onToggleConfig: (id: string) => void;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  /** The hero's month switcher; the screen routes it through the pager. */
  onMonthSwitch: (month: string, direction: MonthDirection) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Attached on the current page only, so a tab re-press scrolls the page in view. */
  scrollRef?: Ref<ScrollView>;
  onMoveCard: (id: string, delta: 1 | -1) => void;
  onResizeCard: (card: OverviewCard) => void;
  onConfigureCard: (id: string, config: Record<string, unknown>) => void;
  onRemoveCard: (card: OverviewCard) => void;
  onDragEnd: (card: OverviewCard, offsetY: number) => void;
  onCardLayout: (id: string) => (event: LayoutChangeEvent) => void;
}

/**
 * Everything on Overview that depends on the month, with its own ScrollView, so the pager
 * can slide the whole window and show a neighbouring month beside the current one.
 */
export const OverviewMonthPage = memo(function OverviewMonthPage({
  month,
  isCurrent,
  dragProgress,
  editing,
  cards,
  configOpenId,
  onToggleConfig,
  onEnterEdit,
  onExitEdit,
  onMonthSwitch,
  onScroll,
  scrollRef,
  onMoveCard,
  onResizeCard,
  onConfigureCard,
  onRemoveCard,
  onDragEnd,
  onCardLayout,
}: OverviewMonthPageProps) {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const metrics = useScreenMetrics();
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
    setGridWidth((current) =>
      Math.abs(current - next) > 0.5 ? next : current,
    );
  };
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  const [togglingRates, setTogglingRates] = useState(false);

  const turnOnAutomaticRates = async () => {
    if (togglingRates) return;
    setTogglingRates(true);
    try {
      await exchangeRateService.setEnabled(true);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that this may have just supplied one.
      await repository.generateRecurring();
    } catch (reason) {
      showError(
        "Couldn’t turn on automatic rates",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setTogglingRates(false);
    }
  };

  const summary = useDashboard(month);

  const currency = state.settings.baseCurrency;
  const locale = state.settings.locale;
  const missingCurrencies = summary.missingExchangeRates.map(
    (rate) => rate.fromCurrency,
  );
  const missingAllUnsupported =
    missingCurrencies.length > 0 &&
    missingCurrencies.every((code) => FRANKFURTER_UNSUPPORTED.has(code));

  // Zero is neutral: only a real gain is green and only a real loss is red.
  const toneColor = (minor: number) => {
    const tone = amountTone(minor);
    return tone === "positive"
      ? theme.positive
      : tone === "negative"
        ? theme.negative
        : theme.text;
  };

  // The net-worth figure is a single line at any width. `adjustsFontSizeToFit` only exists on
  // native; react-native-web ignores it, so the size is also derived from the measured column
  // width and the formatted length (a display digit is ~0.6em wide, the currency/fraction runs
  // are smaller, so this errs slightly small rather than wrapping).
  const [netWorthWidth, setNetWorthWidth] = useState(0);
  const NET_WORTH_BASE_SIZE = 40;
  const netWorthChars = formatMoney(
    summary.netWorthMinor,
    currency,
    locale,
  ).length;
  const netWorthScale =
    netWorthWidth > 0
      ? Math.max(
          0.4,
          Math.min(
            1,
            netWorthWidth / (netWorthChars * 0.6 * NET_WORTH_BASE_SIZE),
          ),
        )
      : 1;

  const cumulativeSpend = useMemo(
    () =>
      summary.dailySpend.reduce<number[]>((running, day) => {
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
    () =>
      gridWidth > 0
        ? packOverviewRows(cards, gridWidth, space.xl, { multiColumn })
        : [],
    [cards, gridWidth, multiColumn, space.xl],
  );

  const renderWidget = (card: OverviewCard, size = card.size) => {
    const definition = WIDGET_REGISTRY[card.type];
    if (!definition) return null;
    const Component = definition.Component;
    return (
      <Component card={card} month={month} size={size} editing={editing} />
    );
  };

  return (
    <ScrollView
      ref={isCurrent ? scrollRef : undefined}
      contentInsetAdjustmentBehavior="automatic"
      onScroll={isCurrent ? onScroll : undefined}
      scrollEventThrottle={16}
      scrollEnabled={isCurrent}
      style={[
        { flex: 1, backgroundColor: theme.background },
        PAGER_SCROLLER_STYLE,
      ]}
    >
      <ScreenContainer>
        {/* Native no longer draws its own copy of this heading: the section
              stack shows a real navigation header titled "Overview". Web keeps
              PageHeading, which is where the document's h1 lives. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: space.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <PageHeading title="Overview" />
          </View>
          {editing ? (
            <TextButton title="Done" icon="checkmark" onPress={onExitEdit} />
          ) : (
            <TextButton title="Customize" icon="gear" onPress={onEnterEdit} />
          )}
        </View>

        <PageHero
          overline="Net worth"
          accessory={
            <MonthSwitcher
              value={month}
              onChange={onMonthSwitch}
              dragProgress={dragProgress}
            />
          }
          figure={
            <View
              style={{ gap: space.xs }}
              onLayout={(event: LayoutChangeEvent) => {
                const next = Math.floor(event.nativeEvent.layout.width);
                setNetWorthWidth((current) =>
                  current === next ? current : next,
                );
              }}
            >
              <AnimatedMoney
                minor={summary.netWorthMinor}
                currency={currency}
                locale={locale}
                variant="display"
                scale={netWorthScale}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
                style={{
                  flexShrink: 1,
                  ...(Platform.OS === "web"
                    ? ({ whiteSpace: "nowrap" } as object)
                    : null),
                }}
              />
              {missingCurrencies.length ? (
                <View style={{ gap: space.xs }}>
                  <AppText
                    literal
                    variant="caption"
                    style={{ color: theme.warning }}
                  >
                    {`Excludes ${missingCurrencies.join(", ")} until an effective exchange rate is added.`}
                  </AppText>
                  <View
                    style={{
                      flexDirection: "row",
                      gap: space.sm,
                      flexWrap: "wrap",
                    }}
                  >
                    {missingAllUnsupported ? (
                      <ActionButton
                        title="Add a manual rate"
                        variant="secondary"
                        onPress={() =>
                          router.push({
                            pathname: "/exchange-rate",
                            params: { currency: missingCurrencies[0] },
                          })
                        }
                      />
                    ) : !rateStatus.enabled ? (
                      <>
                        <ActionButton
                          title="Turn on automatic rates"
                          busy={togglingRates}
                          disabled={togglingRates}
                          onPress={turnOnAutomaticRates}
                        />
                        <ActionButton
                          title="Add manually"
                          variant="secondary"
                          onPress={() =>
                            router.push({
                              pathname: "/exchange-rate",
                              params: { currency: missingCurrencies[0] },
                            })
                          }
                        />
                      </>
                    ) : rateStatus.lastError ? (
                      <ActionButton
                        title="Couldn’t fetch rates — Retry"
                        variant="secondary"
                        onPress={() =>
                          exchangeRateService
                            .ensureRatesForPending({ retry: true })
                            .catch(() => undefined)
                        }
                      />
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          }
          stats={(
            [
              ["Income", summary.incomeMinor, toneColor(summary.incomeMinor)],
              ["Spent", summary.expenseMinor, theme.text],
              [
                "Net flow",
                summary.netFlowMinor,
                toneColor(summary.netFlowMinor),
              ],
            ] as const
          ).map(([label, amount, color]) => ({
            label,
            value: (
              <AnimatedMoney
                minor={amount}
                currency={currency}
                locale={locale}
                compact={contentWidth < 520}
                variant="headline"
                numeric
                style={{ color }}
              />
            ),
          }))}
          footer={
            cumulativeSpend.some((value) => value > 0) ? (
              <View style={{ gap: space.sm }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: space.md,
                  }}
                >
                  <AppText variant="caption" muted>
                    Cumulative spending
                  </AppText>
                  <AnimatedMoney
                    minor={cumulativeSpend[cumulativeSpend.length - 1]}
                    currency={currency}
                    locale={locale}
                    compact={contentWidth < 520}
                    variant="label"
                    numeric
                  />
                </View>
                <MonthContentFade month={month}>
                  <Sparkline
                    values={cumulativeSpend}
                    label={t("Cumulative spending")}
                  />
                </MonthContentFade>
              </View>
            ) : undefined
          }
        />

        {!editing ? (
          cards.length ? (
            <MonthContentFade month={month}>
              <View style={{ gap: space.xl }} onLayout={onGridLayout}>
                {gridWidth === 0
                  ? cards.map((card) => (
                      <MotionView
                        key={card.id}
                        animateLayout
                        style={{ width: "100%" }}
                      >
                        {Platform.OS === "web" ? (
                          renderWidget(card)
                        ) : (
                          <Pressable
                            // A press-and-hold affordance for sighted users only. Left accessible it
                            // would collapse the whole card into one screen-reader element and hide
                            // its buttons; "Customize" is the accessible way into edit mode.
                            accessible={false}
                            delayLongPress={450}
                            onLongPress={onEnterEdit}
                            style={{ width: "100%" }}
                          >
                            {renderWidget(card)}
                          </Pressable>
                        )}
                      </MotionView>
                    ))
                  : rows.map((row, rowIndex) => (
                      <View
                        key={rowIndex}
                        style={
                          multiColumn
                            ? {
                                flexDirection: "row",
                                gap: space.xl,
                                alignItems: "flex-start",
                                flexWrap: "wrap",
                              }
                            : { gap: space.xl }
                        }
                      >
                        {row.cards.map(({ card, width }) => (
                          <MotionView
                            key={card.id}
                            animateLayout
                            style={{ width }}
                          >
                            {Platform.OS === "web" ? (
                              renderWidget(card)
                            ) : (
                              <Pressable
                                accessible={false}
                                delayLongPress={450}
                                onLongPress={onEnterEdit}
                                style={{ width: "100%" }}
                              >
                                {renderWidget(card)}
                              </Pressable>
                            )}
                          </MotionView>
                        ))}
                      </View>
                    ))}
              </View>
            </MonthContentFade>
          ) : (
            <EmptyState
              icon="plus.circle"
              title="Your overview is empty"
              body="Add cards to see budgets, goals and activity here."
            >
              <ActionButton
                title="Add cards"
                icon="plus"
                onPress={() => router.push("/overview-cards")}
              />
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
                  onToggleConfig={() => onToggleConfig(card.id)}
                  onMoveUp={() => onMoveCard(card.id, -1)}
                  onMoveDown={() => onMoveCard(card.id, 1)}
                  onCycleSize={() => onResizeCard(card)}
                  onRemove={() => onRemoveCard(card)}
                  onDragEnd={(offsetY) => onDragEnd(card, offsetY)}
                  onLayout={onCardLayout(card.id)}
                  configSheet={
                    ConfigSheetComponent ? (
                      <ConfigSheetComponent
                        card={card}
                        onConfigure={(config) =>
                          onConfigureCard(card.id, config)
                        }
                      />
                    ) : undefined
                  }
                >
                  {renderWidget(card)}
                </EditableCardFrame>
              );
            })}
            <AddCardWell onPress={() => router.push("/overview-cards")} />
          </View>
        )}
      </ScreenContainer>
    </ScrollView>
  );
});
