import { View } from "react-native";

import { TransactionRow } from "@/components/finance/transaction-row";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { TextButton } from "@/components/ui/text-button";
import { useUpcomingActions } from "@/features/overview/widgets/upcoming-actions";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import type { WidgetProps } from "@/features/overview/widgets/types";

export function UpcomingWidget({ editing, summary }: WidgetProps) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  const { hiddenIds, paidIds, resolve } = useUpcomingActions();

  // Skip and Mark paid take effect after the Undo bar runs out (see `useUpcomingRowActions`). The
  // row leaves the card at once, and Undo brings it back.
  const upcoming = summary.upcomingTransactions.filter(
    (transaction) =>
      !hiddenIds.has(transaction.id) && !paidIds.has(transaction.id),
  );

  if (!upcoming.length) {
    return (
      <View style={{ gap: space.sm }}>
        <SectionHeader title="Coming up" />
        <Card>
          <EmptyState
            compact
            icon="calendar"
            title="Nothing due yet"
            body="Recurring transactions due soon will show up here."
          />
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader title="Coming up" />
      <Card variant="list">
        {upcoming.map((transaction) => (
          <MotionView
            key={transaction.id}
            variant="fade"
            animateLayout
            exit
            style={{ gap: space.xxs, paddingVertical: space.xs }}
          >
            <TransactionRow
              transaction={transaction}
              compact
              returnTo="/overview"
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: space.sm,
              }}
            >
              <TextButton
                title="Skip"
                accessibilityLabel={`${t("Skip")}: ${transaction.title}`}
                tone="muted"
                disabled={editing}
                onPress={() => resolve(transaction.id, "skip")}
              />
              <TextButton
                title="Mark paid"
                accessibilityLabel={`${t("Mark paid")}: ${transaction.title}`}
                disabled={editing}
                onPress={() => resolve(transaction.id, "markPaid")}
              />
            </View>
          </MotionView>
        ))}
      </Card>
    </View>
  );
}
