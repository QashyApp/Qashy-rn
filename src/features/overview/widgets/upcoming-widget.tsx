import { useState } from "react";
import { View } from "react-native";

import { TransactionRow } from "@/components/finance/transaction-row";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { TextButton } from "@/components/ui/text-button";
import {
  markUpcomingPaid,
  upcomingCurrencies,
} from "@/features/transactions/mark-upcoming-paid";
import { useLocalization } from "@/localization/localization";
import { useExchangeRateService } from "@/providers/exchange-rate-provider";
import { useFinanceRepository } from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { hapticSelection, hapticSuccess } from "@/services/haptics";
import type { WidgetProps } from "@/features/overview/widgets/types";

export function UpcomingWidget({ editing, summary }: WidgetProps) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  const repository = useFinanceRepository();
  const exchangeRateService = useExchangeRateService();
  const [pendingUpcomingId, setPendingUpcomingId] = useState<string | null>(
    null,
  );

  const resolveUpcoming = async (id: string, action: "skip" | "confirm") => {
    if (pendingUpcomingId) return;
    setPendingUpcomingId(id);
    try {
      const transaction = summary.upcomingTransactions.find(
        (item) => item.id === id,
      );
      await (action === "skip"
        ? repository.skipUpcoming(id)
        : markUpcomingPaid(
            repository,
            exchangeRateService,
            id,
            transaction ? upcomingCurrencies(transaction) : [],
          ));
      if (action === "confirm") hapticSuccess();
      else hapticSelection();
    } catch (reason) {
      showError(
        action === "skip"
          ? "Couldn’t skip this item"
          : "Couldn’t mark this item paid",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setPendingUpcomingId(null);
    }
  };

  if (!summary.upcomingTransactions.length) {
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
        {summary.upcomingTransactions.map((transaction) => (
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
                disabled={editing || pendingUpcomingId !== null}
                onPress={() => resolveUpcoming(transaction.id, "skip")}
              />
              <TextButton
                title="Mark paid"
                accessibilityLabel={`${t("Mark paid")}: ${transaction.title}`}
                disabled={editing || pendingUpcomingId !== null}
                onPress={() => resolveUpcoming(transaction.id, "confirm")}
              />
            </View>
          </MotionView>
        ))}
      </Card>
    </View>
  );
}
