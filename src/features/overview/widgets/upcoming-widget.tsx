import { useMemo } from "react";
import { View } from "react-native";

import { TransactionRow } from "@/components/finance/transaction-row";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { TextButton } from "@/components/ui/text-button";
import { useUpcomingActions } from "@/features/overview/widgets/upcoming-actions";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import type { WidgetProps } from "@/features/overview/widgets/types";

/** How many scheduled payments the card lists (the summary carries this many). */
const UPCOMING_LIMIT = 5;

export function UpcomingWidget({ editing, summary }: WidgetProps) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  const repository = useFinanceRepository();
  const { transactions } = useFinanceState();
  const { hiddenIds, paidIds, resolve } = useUpcomingActions();

  // Skip and Mark paid take effect after the Undo bar runs out (see `useUpcomingRowActions`). The
  // row leaves the card at once, and Undo brings it back. The summary holds only the first few
  // payments, so while some are leaving the card reads the next ones itself and the limit applies
  // after they are filtered out: the card does not shrink while more payments are due.
  const leaving = hiddenIds.size + paidIds.size > 0;
  const due = useMemo(
    () =>
      leaving
        ? repository.queryTransactions(
            { statuses: ["upcoming"], sort: "oldest" },
            transactions,
          )
        : summary.upcomingTransactions,
    [leaving, repository, transactions, summary.upcomingTransactions],
  );
  const upcoming = due
    .filter(
      (transaction) =>
        !hiddenIds.has(transaction.id) && !paidIds.has(transaction.id),
    )
    .slice(0, UPCOMING_LIMIT);

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
