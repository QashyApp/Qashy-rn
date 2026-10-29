import { useState } from "react";
import { View } from "react-native";

import { CategoryDonut, SpendLineChart } from "@/components/finance/charts";
import { Card } from "@/components/ui/card";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import type { WidgetProps } from "@/features/overview/widgets/types";

export function InsightWidget({ summary }: WidgetProps) {
  const { space } = useQashyTheme();
  const state = useFinanceState();
  const { locale } = useLocalization();
  const currency = state.settings.baseCurrency;
  const [insightMode, setInsightMode] = useState<"trend" | "categories">(
    "trend",
  );

  const insight =
    insightMode === "trend" ? (
      <SpendLineChart
        points={summary.dailySpend}
        currency={currency}
        locale={locale}
      />
    ) : (
      <CategoryDonut
        items={summary.categorySpend}
        currency={currency}
        locale={locale}
      />
    );

  return (
    <Card style={{ gap: space.lg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
          flexWrap: "wrap",
        }}
      >
        <SectionHeader
          title={insightMode === "trend" ? "Spending rhythm" : "By category"}
        />
        <View style={{ minWidth: 220 }}>
          <SegmentedControl
            label="Insight"
            size="compact"
            value={insightMode}
            onChange={setInsightMode}
            options={[
              { value: "trend", label: "Trend" },
              { value: "categories", label: "Categories" },
            ]}
          />
        </View>
      </View>
      <MotionView key={insightMode} variant="fade" exit>
        {insight}
      </MotionView>
    </Card>
  );
}
