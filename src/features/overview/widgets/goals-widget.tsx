import { router } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceListField } from "@/components/ui/choice-list-field";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressRing } from "@/components/ui/progress-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { formatMoney } from "@/utils/money";
import type {
  WidgetConfigSheetProps,
  WidgetProps,
} from "@/features/overview/widgets/types";

const MAX_GOALS_SHOWN = 3;

function useActiveGoals() {
  const state = useFinanceState();
  return useMemo(
    () => state.goals.filter((goal) => !goal.archived && !goal.deletedAt),
    [state.goals],
  );
}

export function GoalsWidget({ card }: WidgetProps) {
  const { space } = useQashyTheme();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { t } = useLocalization();
  const goals = useActiveGoals();
  const goalId =
    typeof card.config.goalId === "string" ? card.config.goalId : undefined;
  const shown = goalId
    ? goals.filter((goal) => goal.id === goalId)
    : goals.slice(0, MAX_GOALS_SHOWN);

  const progressById = useMemo(() => {
    const progress = new Map<string, number>();
    for (const goal of shown)
      progress.set(goal.id, repository.getGoalProgress(goal.id));
    return progress;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repository reads these slices internally
  }, [
    repository,
    shown,
    state.contributions,
    state.transactions,
    state.categories,
  ]);

  if (!shown.length) {
    return (
      <Card>
        <EmptyState
          compact
          icon="target"
          title={
            goalId
              ? "This goal is no longer available"
              : "Save toward something real"
          }
          body="Track a savings target or a planned purchase with manual or linked progress."
        >
          <ActionButton
            title="Create goal"
            icon="plus"
            onPress={() => router.push("/goal")}
          />
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card style={{ gap: space.lg }}>
      <SectionHeader
        title="Goals"
        action="Open plan"
        onAction={() => router.push("/plan")}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
        {shown.map((goal) => {
          const displayProgress = Math.max(0, progressById.get(goal.id) ?? 0);
          const ratio =
            goal.targetMinor > 0 ? displayProgress / goal.targetMinor : 0;
          const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
          return (
            <View
              key={goal.id}
              style={{ alignItems: "center", gap: space.sm, minWidth: 96 }}
            >
              <ProgressRing
                value={ratio}
                color={goal.color}
                label={`${goal.name}: ${percent}%`}
              >
                <AppText
                  literal
                  numeric
                  variant="label"
                >{`${percent}%`}</AppText>
              </ProgressRing>
              <AppText
                literal
                variant="caption"
                numberOfLines={1}
                style={{ maxWidth: 110, textAlign: "center" }}
              >
                {goal.name}
              </AppText>
              <AnimatedMoney
                minor={displayProgress}
                currency={state.settings.baseCurrency}
                locale={state.settings.locale}
                variant="caption"
                numeric
                muted
              />
              <AppText
                literal
                variant="caption"
                muted
                numeric
              >{`${t("of")} ${formatMoney(goal.targetMinor, state.settings.baseCurrency, state.settings.locale)}`}</AppText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function GoalsConfigSheet({
  card,
  onConfigure,
}: WidgetConfigSheetProps) {
  const goals = useActiveGoals();
  const goalId =
    typeof card.config.goalId === "string" ? card.config.goalId : "";

  return (
    <ChoiceListField
      label="Goal"
      value={goalId}
      literalOptions
      onChange={(value) => onConfigure({ goalId: value || null })}
      options={[
        { value: "", label: "All goals" },
        ...goals.map((goal) => ({ value: goal.id, label: goal.name })),
      ]}
    />
  );
}
