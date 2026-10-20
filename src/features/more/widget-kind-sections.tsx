import type { ComponentType } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { OptionRow } from "@/components/ui/option-row";
import { QashySwitch } from "@/components/ui/qashy-switch";
import type {
  BudgetWidgetConfig,
  KindFields,
  QuickAddWidgetConfig,
  WidgetConfig,
  WidgetKind,
} from "@/features/widgets/kinds";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";

export interface KindSectionProps<C extends WidgetConfig> {
  config: C;
  /** Saves a change to the kind's own fields; resolves true when it was saved. */
  change: (patch: Partial<KindFields<C>>) => Promise<boolean>;
}

interface WidgetKindUi<C extends WidgetConfig> {
  /** The card heading (numbered by the screen when several of the kind are placed). */
  title: string;
  Section: ComponentType<KindSectionProps<C>>;
}

type Metric = "showNetWorth" | "showSpent" | "showEarned";

const METRICS: { field: Metric; label: string }[] = [
  { field: "showNetWorth", label: "Net worth" },
  { field: "showSpent", label: "Spent" },
  { field: "showEarned", label: "Income" },
];

function QuickAddSection({
  config,
  change,
}: KindSectionProps<QuickAddWidgetConfig>) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="label">Show on the widget</AppText>
      <AppText variant="caption" muted>
        With none selected, the widget is just the add button.
      </AppText>
      {METRICS.map(({ field, label }) => (
        <View
          key={field}
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.md,
          }}
        >
          <AppText style={{ flex: 1 }}>{label}</AppText>
          <QashySwitch
            accessibilityLabel={t(label)}
            value={config[field]}
            onValueChange={(value) => {
              void change({ [field]: value });
            }}
          />
        </View>
      ))}
    </View>
  );
}

function BudgetSection({
  config,
  change,
}: KindSectionProps<BudgetWidgetConfig>) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  const { budgets } = useFinanceState();
  // The Plan screen's order; archived (an older peer may still send one) and deleted are not offered.
  const liveBudgets = budgets.filter(
    (budget) => !budget.archived && !budget.deletedAt,
  );
  const selectedId = liveBudgets.some((budget) => budget.id === config.budgetId)
    ? config.budgetId
    : null;
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="label">Budget to show</AppText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Budget to show")}
        style={{ gap: space.sm }}
      >
        <OptionRow
          title="First active budget"
          selected={selectedId === null}
          onPress={() => change({ budgetId: null })}
        />
        {liveBudgets.map((budget) => (
          <OptionRow
            key={budget.id}
            literal
            title={budget.name}
            selected={selectedId === budget.id}
            onPress={() => change({ budgetId: budget.id })}
          />
        ))}
      </View>
    </View>
  );
}

type Ui = {
  [K in WidgetKind]: WidgetKindUi<Extract<WidgetConfig, { kind: K }>>;
};

const UI: Ui = {
  quickAdd: { title: "Quick add widget", Section: QuickAddSection },
  budget: { title: "Budget widget", Section: BudgetSection },
};

export function widgetKindTitle(kind: WidgetKind): string {
  return UI[kind].title;
}

/** Renders the section of `config`'s kind. */
export function WidgetKindSection({
  config,
  change,
}: KindSectionProps<WidgetConfig>) {
  // The lookup by a union-typed kind loses the pairing of section and config type.
  const Section = UI[config.kind].Section as ComponentType<
    KindSectionProps<WidgetConfig>
  >;
  return <Section config={config} change={change} />;
}
