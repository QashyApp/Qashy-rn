import { router } from "expo-router";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type Ref,
  type RefObject,
} from "react";
import Animated from "react-native-reanimated";
import {
  Platform,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { Sparkline } from "@/components/finance/sparkline";
import { ActionButton } from "@/components/ui/action-button";
import type { OverviewLayoutStatus } from "@/features/overview/layout/use-overview-layout";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import {
  MonthSlideItem,
  PAGER_SCROLLER_STYLE,
} from "@/components/ui/month-pager";
import { MotionView } from "@/components/ui/motion";
import { PageHero } from "@/components/ui/page-hero";
import { ScreenContainer } from "@/components/ui/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { FRANKFURTER_UNSUPPORTED } from "@/data/exchange-rates/frankfurter";
import { AddCardWell } from "@/features/overview/card-gallery-screen";
import { HoldToCustomize } from "@/features/overview/card-stack-motion";
import { DropIndicator } from "@/features/overview/edit/drop-indicator";
import { EditableCardFrame } from "@/features/overview/edit/editable-card-frame";
import { useCardReorder } from "@/features/overview/edit/use-card-reorder";
import { WIDGET_RULES, type OverviewCard } from "@/domain/overview-layout";
import {
  GRID_BREAKPOINT,
  packOverviewRows,
  slideOrders,
} from "@/features/overview/widgets/grid";
import { WIDGET_REGISTRY } from "@/features/overview/widgets/registry";
import { useDashboard } from "@/features/overview/widgets/use-dashboard";
import { useLocalization } from "@/localization/localization";
import {
  useExchangeRateService,
  useExchangeRateStatus,
} from "@/providers/exchange-rate-provider";
import { useFinanceState } from "@/providers/finance-provider";
import { useScreenMetrics } from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { useTurnOnAutomaticRates } from "@/features/shared/use-automatic-rates";
import { amountTone } from "@/utils/labels";
import { formatMoney } from "@/utils/money";

export interface OverviewMonthPageProps {
  month: string;
  /** Only the current page scrolls and reports scroll offsets to the floating button. */
  isCurrent: boolean;
  editing: boolean;
  /**
   * `loading` shows a skeleton in the card area; `unavailable` shows the default cards as a
   * read-only placeholder (no hold-to-customize); `ready` is the saved layout.
   */
  layoutStatus: OverviewLayoutStatus;
  cards: readonly OverviewCard[];
  configOpenId: string | null;
  onToggleConfig: (id: string) => void;
  onEnterEdit: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Attached on the current page only, so a tab re-press scrolls the page in view. */
  scrollRef?: Ref<ScrollViewInstance>;
  onMoveCard: (id: string, delta: 1 | -1) => void;
  onResizeCard: (card: OverviewCard) => void;
  onConfigureCard: (id: string, config: Record<string, unknown>) => void;
  onRemoveCard: (card: OverviewCard) => void;
  /**
   * A dragged card was released on `toIndex`. `null` when the order does not change, else a
   * promise that settles (never rejects) when the save has, to whether it was saved.
   */
  onDropCard: (id: string, toIndex: number) => Promise<boolean> | null;
}

/**
 * Everything on Overview that depends on the month, with its own ScrollView, so the pager
 * can slide the whole window and show a neighbouring month beside the current one. The heading,
 * Customize and the month switcher live above the pager (see `OverviewScreen`).
 *
 * Memoised on props that keep their identity across a month change (the screen's handlers are
 * stable), so a swipe renders only the pages whose `isCurrent` or data changed.
 */
export const OverviewMonthPage = memo(function OverviewMonthPage({
  month,
  isCurrent,
  editing,
  layoutStatus,
  cards,
  configOpenId,
  onToggleConfig,
  onEnterEdit,
  onScroll,
  scrollRef,
  onMoveCard,
  onResizeCard,
  onConfigureCard,
  onRemoveCard,
  onDropCard,
}: OverviewMonthPageProps) {
  const layoutReady = layoutStatus === "ready";
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const { locale, t } = useLocalization();
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

  const { turningOn: togglingRates, turnOn: turnOnAutomaticRates } =
    useTurnOnAutomaticRates();

  // Computed once here and handed to every card, instead of one repository read per widget.
  const summary = useDashboard(month);

  // The page needs its own handle on the ScrollView (the UI thread scrolls it while a card is
  // dragged near an edge), so the screen's ref is fed from a callback ref rather than attached
  // directly.
  const {
    reorder,
    dragging,
    scrollProps,
    scrollRef: animatedScrollRef,
  } = useCardReorder({ cards, gap: space.xl });
  const outerScrollRef = isCurrent ? scrollRef : undefined;
  const setScrollRef = useCallback(
    (node: ScrollViewInstance | null) => {
      animatedScrollRef(node as ScrollViewInstance);
      if (typeof outerScrollRef === "function") outerScrollRef(node);
      else if (outerScrollRef) {
        (outerScrollRef as RefObject<ScrollViewInstance | null>).current = node;
      }
    },
    [animatedScrollRef, outerScrollRef],
  );

  const reorderOnScroll = scrollProps.onScroll;
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      reorderOnScroll(event);
      onScroll(event);
    },
    [reorderOnScroll, onScroll],
  );

  const currency = state.settings.baseCurrency;
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
      ? theme.positiveText
      : tone === "negative"
        ? theme.negativeText
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
  // One flat, wrapping list of cards whatever the width: a card's width is `100%` until the
  // container has been measured (and always on a narrow screen), then its packed pixel width. The
  // keys and the tree never change with the measurement, so no card remounts when it arrives.
  // Cards wrap exactly where `packOverviewRows` starts a new row, because the packed widths and
  // the gap add up to the container width.
  // The rows only depend on the sizes, so a card's place in the cascade is known before the
  // container has been measured; its pixel width is not.
  const { cardWidths, cardOrders } = useMemo(() => {
    const widths = new Map<string, number>();
    const rows = packOverviewRows(cards, gridWidth, space.xl, { multiColumn });
    if (multiColumn && gridWidth > 0) {
      for (const row of rows) {
        for (const packed of row.cards) widths.set(packed.id, packed.width);
      }
    }
    return { cardWidths: widths, cardOrders: slideOrders(rows) };
  }, [cards, gridWidth, multiColumn, space.xl]);

  const renderWidget = (card: OverviewCard, size = card.size) => {
    const definition = WIDGET_REGISTRY[card.type];
    if (!definition) return null;
    const Component = definition.Component;
    return (
      <Component
        card={card}
        month={month}
        size={size}
        editing={editing}
        summary={summary}
      />
    );
  };

  return (
    <Animated.ScrollView
      ref={setScrollRef}
      onScroll={isCurrent ? handleScroll : undefined}
      onLayout={scrollProps.onLayout}
      onContentSizeChange={scrollProps.onContentSizeChange}
      scrollEventThrottle={16}
      // A held card owns the finger: the page only moves for the auto-scroll at its edges.
      scrollEnabled={isCurrent && !dragging}
      style={[
        { flex: 1, backgroundColor: theme.background },
        PAGER_SCROLLER_STYLE,
      ]}
    >
      <ScreenContainer style={{ paddingTop: space.md }}>
        <MonthSlideItem order={0}>
          <PageHero
            overline="Net worth"
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
                      style={{ color: theme.warningText }}
                    >
                      {t(
                        `Excludes ${missingCurrencies.join(", ")} until an effective exchange rate is added.`,
                      )}
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
                  <Sparkline
                    values={cumulativeSpend}
                    label={t("Cumulative spending")}
                  />
                </View>
              ) : undefined
            }
          />
        </MonthSlideItem>

        {layoutStatus === "loading" ? (
          // The saved layout is still loading: hold the place rather than flash the defaults.
          <MonthSlideItem order={1}>
            <View
              style={{ gap: space.xl }}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Skeleton width="100%" height={176} radius={theme.radius.card} />
              <Skeleton width="100%" height={176} radius={theme.radius.card} />
            </View>
          </MonthSlideItem>
        ) : !editing ? (
          cards.length ? (
            <MotionView key="view" variant="fade">
              <View
                onLayout={onGridLayout}
                style={
                  multiColumn
                    ? {
                        flexDirection: "row",
                        flexWrap: "wrap",
                        alignItems: "flex-start",
                        columnGap: space.xl,
                        rowGap: space.xl,
                      }
                    : { gap: space.xl }
                }
              >
                {cards.map((card) => (
                  <MotionView
                    key={card.id}
                    animateLayout
                    style={{ width: cardWidths.get(card.id) ?? "100%" }}
                  >
                    <MonthSlideItem order={cardOrders.get(card.id) ?? 1}>
                      {Platform.OS === "web" || !layoutReady ? (
                        renderWidget(card)
                      ) : (
                        <HoldToCustomize onActivate={onEnterEdit}>
                          {renderWidget(card)}
                        </HoldToCustomize>
                      )}
                    </MonthSlideItem>
                  </MotionView>
                ))}
              </View>
            </MotionView>
          ) : (
            <MonthSlideItem order={1}>
              <EmptyState
                icon="plus.circle"
                title="Your overview is empty"
                body="Add cards to see budgets, goals and activity here."
              >
                <ActionButton
                  title="Add cards"
                  icon="plus"
                  disabled={!layoutReady}
                  onPress={() => router.push("/overview-cards")}
                />
              </EmptyState>
            </MonthSlideItem>
          )
        ) : (
          <MotionView key="edit" variant="fade">
            {/* The same gap as view mode, so entering edit mode does not shift the layout. */}
            <View style={{ gap: space.xl }}>
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
                    id={card.id}
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
                    reorder={reorder}
                    onDrop={onDropCard}
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
              <DropIndicator reorder={reorder} />
              <AddCardWell onPress={() => router.push("/overview-cards")} />
            </View>
          </MotionView>
        )}
      </ScreenContainer>
    </Animated.ScrollView>
  );
});
