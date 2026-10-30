import { router } from "expo-router";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  View,
  type ScrollViewInstance,
  type ViewStyle,
} from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MotionView } from "@/components/ui/motion";
import { PageHeading } from "@/components/ui/page-heading";
import { ProgressBar, ProgressRing } from "@/components/ui/progress-bar";
import { ScreenContainer } from "@/components/ui/screen-container";
import { SectionHeader } from "@/components/ui/section-header";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { BudgetStatus, Goal } from "@/domain/models";
import {
  BatchDeleteBar,
  useBatchDelete,
} from "@/features/more/use-batch-delete";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useScreenMetrics } from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { mediumDate, toLocalDate } from "@/utils/date";
import { useNow } from "@/hooks/use-now";
import { hapticSuccess } from "@/services/haptics";
import { formatMoney } from "@/utils/money";
import { budgetPace, type BudgetPaceStatus } from "@/utils/pace";

const GOAL_MILESTONES = [0.25, 0.5, 0.75, 1];
/** Reaching a spending goal's target is not a celebration, so it has no pulse at 100%. */
const SPENDING_GOAL_MILESTONES = [0.25, 0.5, 0.75];
/** Below this content width, budget and goal cards always stack one per row;
 * a two-up card is too cramped under it to read as anything but squeezed. */
const WIDE_GRID_BREAKPOINT = 900;

const PACE_PRESENTATION: Record<
  BudgetPaceStatus,
  { label: string; tone: StatusTone; icon: string }
> = {
  under: { label: "Under pace", tone: "positive", icon: "checkmark.circle" },
  onTrack: { label: "On track", tone: "neutral", icon: "checkmark" },
  projectedOver: {
    label: "Over pace",
    tone: "warning",
    icon: "exclamationmark.triangle",
  },
  over: {
    label: "Over budget",
    tone: "negative",
    icon: "exclamationmark.triangle",
  },
};

/**
 * Fires `onMilestone` the first time `ratio` crosses upward through each of
 * `milestones` after mount, mirroring the celebratory pulse `ProgressBar`
 * gives itself internally. Goals here render a `ProgressRing` instead, which
 * has no such built-in tracking, so the crossing detector moves here rather
 * than duplicating an invisible `ProgressBar` purely to reuse its internal effect.
 */
function useMilestoneHaptics(
  ratio: number,
  milestones: number[],
  onMilestone: (milestone: number) => void,
) {
  const previousRef = useRef(ratio);
  const mountedRef = useRef(false);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = ratio;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const crossed = milestones.filter(
      (milestone) => previous < milestone && ratio >= milestone,
    );
    if (crossed.length) onMilestone(Math.max(...crossed));
  }, [ratio, milestones, onMilestone]);
}

export function PlanScreen() {
  const scrollRef = useSectionScrollToTop<ScrollViewInstance>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { contentWidth } = useScreenMetrics();
  const wide = contentWidth >= WIDE_GRID_BREAKPOINT;
  const today = toLocalDate(new Date(useNow()));
  // The repository reads these state slices internally, so they must stay in
  // the deps even though the callback does not reference them directly.
  const budgets = useMemo(
    () =>
      repository.getBudgetStatuses(today, {
        includeInactiveCustom: true,
        includePendingAutoPosts: true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repository reads these slices internally
    [
      repository,
      today,
      state.budgets,
      state.budgetPeriods,
      state.budgetAdjustments,
      state.transactions,
      state.categories,
      state.recurringRules,
      state.exchangeRates,
    ],
  );
  const goals = useMemo(
    () => state.goals.filter((item) => !item.archived && !item.deletedAt),
    [state.goals],
  );
  const goalProgress = useMemo(() => {
    const progress = new Map<string, number>();
    for (const goal of goals)
      progress.set(goal.id, repository.getGoalProgress(goal.id));
    return progress;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repository reads these slices internally
  }, [
    repository,
    goals,
    state.contributions,
    state.transactions,
    state.categories,
  ]);

  const budgetSelection = useBatchDelete({
    type: "budgets",
    liveIds: budgets.map((item) => item.budget.id),
    confirmTitle: (count) =>
      count === 1 ? "Delete 1 budget?" : `Delete ${count} budgets?`,
    confirmMessage: "Past period snapshots are removed with them.",
    errorTitle: "Couldn’t delete budgets",
  });
  const goalSelection = useBatchDelete({
    type: "goals",
    liveIds: goals.map((item) => item.id),
    confirmTitle: (count) =>
      count === 1 ? "Delete 1 goal?" : `Delete ${count} goals?`,
    confirmMessage: "Manual contributions are removed with them.",
    errorTitle: "Couldn’t delete goals",
  });

  const cardBasis: ViewStyle = wide
    ? { flexBasis: "48%", flexGrow: 1, minWidth: 320 }
    : { width: "100%" };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <ScreenContainer>
        <PageHeading
          title="Plan"
          subtitle="Set flexible limits and track progress toward meaningful goals."
        />

        <PlanSection
          title="Budgets"
          addLabel="Add budget"
          createRoute="/budget"
          selection={budgetSelection}
          hasItems={budgets.length > 0}
          empty={
            <EmptyState
              compact
              icon="chart"
              title="Give spending a gentle boundary"
              body="Create a monthly, weekly, yearly, or one-off budget. Nothing is forced into envelopes."
            >
              <ActionButton
                title="Create a budget"
                icon="plus"
                onPress={() => router.push("/budget")}
              />
            </EmptyState>
          }
        >
          {budgets.map((status) => (
            <View key={status.budget.id} style={cardBasis}>
              <SelectableCard
                selecting={budgetSelection.selecting}
                fill={wide}
                selected={budgetSelection.selectedIds.includes(
                  status.budget.id,
                )}
                disabled={budgetSelection.deleting}
                label={status.budget.name}
                onToggle={() => budgetSelection.toggle(status.budget.id)}
              >
                <BudgetCard status={status} today={today} fill={wide} />
              </SelectableCard>
            </View>
          ))}
        </PlanSection>

        <PlanSection
          title="Goals"
          addLabel="Add goal"
          createRoute="/goal"
          selection={goalSelection}
          hasItems={goals.length > 0}
          empty={
            <EmptyState
              compact
              icon="target"
              title="Save toward something real"
              body="Track a savings target or a planned purchase with manual or linked progress."
            >
              <ActionButton
                title="Create a goal"
                icon="plus"
                onPress={() => router.push("/goal")}
              />
            </EmptyState>
          }
        >
          {goals.map((goal) => (
            <View key={goal.id} style={cardBasis}>
              <SelectableCard
                selecting={goalSelection.selecting}
                fill={wide}
                selected={goalSelection.selectedIds.includes(goal.id)}
                disabled={goalSelection.deleting}
                label={goal.name}
                onToggle={() => goalSelection.toggle(goal.id)}
              >
                <GoalCard
                  goal={goal}
                  progress={goalProgress.get(goal.id) ?? 0}
                  fill={wide}
                />
              </SelectableCard>
            </View>
          ))}
        </PlanSection>
      </ScreenContainer>
    </ScrollView>
  );
}

/** A titled card grid (budgets or goals) with add and multi-select controls and an empty state. */
function PlanSection({
  title,
  addLabel,
  createRoute,
  selection,
  hasItems,
  empty,
  children,
}: {
  title: string;
  addLabel: string;
  createRoute: "/budget" | "/goal";
  selection: ReturnType<typeof useBatchDelete>;
  hasItems: boolean;
  empty: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader
        title={title}
        action={hasItems && !selection.selecting ? addLabel : undefined}
        actionIcon="plus"
        onAction={() => router.push(createRoute)}
        secondaryAction={
          hasItems
            ? selection.selecting
              ? "Done selecting"
              : "Select"
            : undefined
        }
        onSecondaryAction={selection.toggleMode}
      />
      {hasItems ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          {children}
        </View>
      ) : (
        <Card>{empty}</Card>
      )}
      {selection.selecting ? (
        <BatchDeleteBar
          count={selection.liveSelectedCount}
          busy={selection.deleting}
          onDelete={selection.deleteSelected}
        />
      ) : null}
    </View>
  );
}

/** In selection mode the whole card becomes one toggle; its inner buttons are inert. */
function SelectableCard({
  selecting,
  fill,
  selected,
  disabled,
  label,
  onToggle,
  children,
}: {
  selecting: boolean;
  fill: boolean;
  selected: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  const theme = useQashyTheme();
  if (!selecting) return <>{children}</>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={{
        height: fill ? "100%" : undefined,
        borderRadius: theme.radius.card,
        borderWidth: 2,
        borderColor: selected ? theme.accent : "transparent",
      }}
    >
      <View pointerEvents="none" style={{ height: fill ? "100%" : undefined }}>
        {children}
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: "absolute",
          top: 12,
          end: 12,
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: selected ? theme.accent : theme.textMuted,
          backgroundColor: selected ? theme.accent : theme.surface,
        }}
      >
        {selected ? (
          <AppIcon name="checkmark" color={theme.staticSurface} size={14} />
        ) : null}
      </View>
    </Pressable>
  );
}

function BudgetCard({
  status,
  today,
  fill,
}: {
  status: BudgetStatus;
  today: string;
  fill: boolean;
}) {
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const { locale, t } = useLocalization();
  const {
    budget,
    snapshot,
    spentMinor,
    adjustmentMinor,
    effectiveLimitMinor,
    categorySpend,
  } = status;
  const pace = budgetPace({
    spentMinor,
    limitMinor: effectiveLimitMinor,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    today,
  });
  const presentation = PACE_PRESENTATION[pace.status];
  const barColor =
    pace.status === "over" ? (theme.negative as string) : budget.color;
  const customState =
    budget.period.unit === "custom"
      ? today > snapshot.periodEnd
        ? `${t("Ended")} · `
        : today < snapshot.periodStart
          ? `${t("Upcoming")} · `
          : ""
      : "";
  // Dates and the rollover amount are data, so the caption is assembled with
  // its translatable words already resolved and then rendered verbatim.
  const money = (minor: number, options?: { sign: boolean }) =>
    formatMoney(minor, state.settings.baseCurrency, locale, options);
  const signed = (minor: number) => money(minor, { sign: true });
  const periodSummary = `${customState}${t(budget.period.unit)} · ${mediumDate(snapshot.periodStart, locale)} ${t("to")} ${mediumDate(snapshot.periodEnd, locale)}${budget.rollover ? ` · ${t("rollover")} ${signed(snapshot.rolloverMinor)}` : ""}${adjustmentMinor ? ` · ${t("adjusted")} ${signed(adjustmentMinor)}` : ""}`;
  // A custom budget outside its window has no current period to adjust.
  const canAdjust = !customState;

  return (
    <MotionView
      variant="fade"
      animateLayout
      exit
      style={fill ? { height: "100%" } : undefined}
    >
      <Card style={fill ? { gap: 14, height: "100%" } : { gap: 14 }}>
        <View style={{ gap: space.xxs }}>
          <AppText literal variant="headline">
            {budget.name}
          </AppText>
          <AppText literal variant="caption" muted>
            {periodSummary}
          </AppText>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            gap: space.sm,
            flexWrap: "wrap",
          }}
        >
          <AnimatedMoney
            variant="money"
            numeric
            minor={spentMinor}
            currency={state.settings.baseCurrency}
            locale={locale}
          />
          <AppText
            variant="caption"
            muted
          >{`${t("of")} ${money(effectiveLimitMinor)}`}</AppText>
        </View>

        <ProgressBar
          label={`${budget.name}: ${t("Budget progress")}`}
          value={pace.spentRatio}
          color={barColor}
          // Reaching the limit is a warning, not the celebratory milestone pulse.
          milestones={[]}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.sm,
            flexWrap: "wrap",
          }}
        >
          <StatusPill
            label={presentation.label}
            icon={presentation.icon}
            tone={presentation.tone}
          />
          {pace.projectionReliable ? (
            <AppText literal variant="caption" muted numeric>
              {`${t("Projected")}: ${money(pace.projectedMinor)} ${t("by")} ${mediumDate(snapshot.periodEnd, locale)}`}
            </AppText>
          ) : null}
        </View>

        {categorySpend.length ? (
          <Card variant="inset" style={{ gap: 10 }}>
            {categorySpend.map((limit) => {
              const category = state.categories.find(
                (item) => item.id === limit.categoryId,
              );
              if (!category) return null;
              const overCap =
                limit.limitMinor > 0 && limit.amountMinor > limit.limitMinor;
              return (
                <View key={limit.categoryId} style={{ gap: 6 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: space.sm,
                    }}
                  >
                    <AppText literal variant="caption">
                      {category.name}
                    </AppText>
                    <AppText
                      literal
                      variant="caption"
                      muted
                      numeric
                    >{`${money(limit.amountMinor)} / ${money(limit.limitMinor)}`}</AppText>
                  </View>
                  <ProgressBar
                    size="thin"
                    label={`${category.name}: ${t("Category budget progress")}`}
                    milestones={[]}
                    value={
                      limit.limitMinor > 0
                        ? limit.amountMinor / limit.limitMinor
                        : limit.amountMinor > 0
                          ? 1
                          : 0
                    }
                    color={
                      overCap ? (theme.negative as string) : category.color
                    }
                  />
                </View>
              );
            })}
          </Card>
        ) : null}

        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <ActionButton
              title="Edit"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/budget", params: { id: budget.id } })
              }
            />
          </View>
          {canAdjust ? (
            <View style={{ flex: 1 }}>
              <ActionButton
                title="Adjust"
                icon="plus"
                variant="secondary"
                accessibilityLabel={`${t("Adjust")} ${budget.name}`}
                onPress={() =>
                  router.push({
                    pathname: "/budget-adjustment",
                    params: { budgetId: budget.id },
                  })
                }
              />
            </View>
          ) : null}
        </View>
      </Card>
    </MotionView>
  );
}

function GoalCard({
  goal,
  progress,
  fill,
}: {
  goal: Goal;
  progress: number;
  fill: boolean;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const state = useFinanceState();
  const { locale, t, isRtl } = useLocalization();
  const displayProgress = Math.max(0, progress);
  const ratio = goal.targetMinor > 0 ? displayProgress / goal.targetMinor : 0;
  // A spending goal is a ceiling: past it the card says by how much, and shows the real percent.
  const over = goal.kind === "spending" && displayProgress > goal.targetMinor;
  const percent = Math.max(
    0,
    Math.min(over ? 999 : 100, Math.round(ratio * 100)),
  );
  const remainingMinor = Math.max(0, goal.targetMinor - displayProgress);
  const overMinor = Math.max(0, displayProgress - goal.targetMinor);
  useMilestoneHaptics(
    ratio,
    goal.kind === "spending" ? SPENDING_GOAL_MILESTONES : GOAL_MILESTONES,
    hapticSuccess,
  );
  const money = (minor: number) =>
    formatMoney(minor, state.settings.baseCurrency, locale);
  const byDate = goal.targetDate
    ? ` · ${t("by")} ${mediumDate(goal.targetDate, locale)}`
    : "";

  return (
    <MotionView
      variant="fade"
      animateLayout
      exit
      style={fill ? { height: "100%" } : undefined}
    >
      <Card style={fill ? { gap: 14, height: "100%" } : { gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <ProgressRing
            value={ratio}
            size={72}
            color={over ? (theme.negative as string) : goal.color}
            label={`${goal.name}: ${t("Goal progress")}${over ? ` · ${t("Over target")}` : ""}`}
          >
            <AppText literal numeric variant="label">{`${percent}%`}</AppText>
          </ProgressRing>
          <View style={{ flex: 1, gap: space.xxs }}>
            <AppText literal variant="headline">
              {goal.name}
            </AppText>
            <AppText
              literal
              variant="caption"
              muted
            >{`${t(goal.kind === "saving" ? "Savings goal" : "Planned purchase")}${byDate}`}</AppText>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: space.sm,
            flexWrap: "wrap",
          }}
        >
          <AnimatedMoney
            variant="money"
            minor={displayProgress}
            currency={state.settings.baseCurrency}
            locale={locale}
          />
          <AppText
            literal
            variant="caption"
            muted
          >{`${t("of")} ${money(goal.targetMinor)}`}</AppText>
        </View>
        <AppText
          literal
          variant="caption"
          muted={!over}
          numeric
          style={over ? { color: theme.negativeText } : undefined}
        >
          {/* Hebrew puts the "remaining" verb before the amount ("נותרו $X"), the reverse
              of the English "$X remaining" order, so the fragments are composed per
              direction rather than concatenated in a single fixed order. "over target" follows
              the same rule ("חריגה של $X"). A spending goal past its target says so in
              words, in the danger text color. */}
          {over
            ? isRtl
              ? `${t("over target")} ${money(overMinor)}${byDate}`
              : `${money(overMinor)} ${t("over target")}${byDate}`
            : isRtl
              ? `${t("remaining")} ${money(remainingMinor)}${byDate}`
              : `${money(remainingMinor)} ${t("remaining")}${byDate}`}
        </AppText>

        <ActionButton
          title="Open"
          variant="secondary"
          onPress={() =>
            router.push({ pathname: "/goal", params: { id: goal.id } })
          }
        />
      </Card>
    </MotionView>
  );
}
