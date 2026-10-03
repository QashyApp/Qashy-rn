import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { AmountHero } from "@/components/finance/amount-hero";
import { useFormSheet } from "@/components/navigation/use-form-sheet";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { FormScreen } from "@/components/ui/form-screen";
import {
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui/segmented-control";
import { TextButton } from "@/components/ui/text-button";
import type { BudgetAdjustment } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { mediumDate, todayLocal } from "@/utils/date";
import { validateMoneyInput } from "@/utils/form-validation";
import { hapticSuccess } from "@/utils/haptics";
import { formatMoney, parseMoney } from "@/utils/money";

type Direction = "add" | "reduce";

const DIRECTIONS: readonly SegmentOption<Direction>[] = [
  { value: "add", label: "Add funds", icon: "plus" },
  { value: "reduce", label: "Reduce budget", icon: "minus" },
];

/**
 * A one-time change to the current period's limit: money handed out, or a deliberate cut.
 *
 * Deliberately not an edit of the budget. The recurring limit is left alone, and the change
 * counts only toward the period it is made in (see `BudgetAdjustment`).
 */
export function BudgetAdjustmentScreen() {
  const { budgetId } = useLocalSearchParams<{ budgetId?: string }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const today = todayLocal();
  const { baseCurrency, locale } = state.settings;
  const status = useMemo(
    () =>
      repository
        .getBudgetStatuses(today, { includeInactiveCustom: true })
        .find((item) => item.budget.id === budgetId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repository reads these slices internally
    [
      repository,
      today,
      budgetId,
      state.budgets,
      state.budgetPeriods,
      state.budgetAdjustments,
      state.transactions,
    ],
  );
  const [direction, setDirection] = useState<Direction>("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { closeToOwner } = useFormSheet({
    ownerRoute: "/plan",
    values: { direction, amount, note },
  });

  if (!status) return <Redirect href="/plan" />;
  const { budget, snapshot, effectiveLimitMinor, adjustments } = status;

  const formatError = validateMoneyInput(amount, baseCurrency, locale, {
    label: "Amount",
    positive: true,
  });
  const parsedMinor =
    amount.trim() && !formatError
      ? parseMoney(amount, baseCurrency, locale)
      : null;
  const signedMinor =
    parsedMinor === null
      ? null
      : direction === "add"
        ? parsedMinor
        : -parsedMinor;
  const nextLimitMinor =
    signedMinor === null ? null : effectiveLimitMinor + signedMinor;
  const previewable =
    nextLimitMinor !== null && Number.isSafeInteger(nextLimitMinor);
  // The repository is the authority; this only saves a round trip for the common mistake.
  const belowZero =
    previewable &&
    signedMinor !== null &&
    signedMinor < 0 &&
    nextLimitMinor < 0;
  const error = amount.trim()
    ? (formatError ??
      (belowZero ? "This would reduce the budget below zero." : undefined))
    : undefined;
  const canSave = signedMinor !== null && previewable && !error;
  const money = (minor: number, sign = false) =>
    formatMoney(minor, baseCurrency, locale, sign ? { sign: true } : undefined);

  const save = async () => {
    if (busy || !canSave || signedMinor === null) return;
    setBusy(true);
    try {
      await repository.addBudgetAdjustment({
        budgetId: budget.id,
        amountMinor: signedMinor,
        note,
      });
      hapticSuccess();
      closeToOwner();
    } catch (reason) {
      showError("Couldn’t save adjustment", errorMessage(reason, "Try again."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: BudgetAdjustment) => {
    if (busy) return;
    if (
      !(await confirmDestructive({
        title: "Delete this adjustment?",
        message: `${money(item.amountMinor, true)} will be removed from this period’s limit.`,
      }))
    )
      return;
    setBusy(true);
    try {
      await repository.deleteBudgetAdjustment(item.id);
    } catch (reason) {
      showError(
        "Couldn’t delete adjustment",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
      <Card style={{ gap: 4 }}>
        <AppText literal variant="headline">
          {budget.name}
        </AppText>
        <AppText
          literal
          variant="caption"
          muted
        >{`${mediumDate(snapshot.periodStart, locale)} ${t("to")} ${mediumDate(snapshot.periodEnd, locale)}`}</AppText>
        <AppText literal numeric>
          {`${t("Limit this period")}: ${money(effectiveLimitMinor)}${previewable ? ` → ${money(nextLimitMinor)}` : ""}`}
        </AppText>
      </Card>

      <SegmentedControl
        label="Adjustment type"
        options={DIRECTIONS}
        value={direction}
        onChange={setDirection}
      />

      <AmountHero
        label="Amount"
        size="display"
        currency={baseCurrency}
        value={amount}
        onChangeText={setAmount}
        error={error}
        autoFocus
      />

      <Card style={{ gap: 12 }}>
        <FormField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="For example, birthday money"
        />
        <AppText variant="caption" muted>
          {budget.rollover
            ? "One time, for this period only. Anything left unspent carries into the next period."
            : "One time, for this period only. It expires when the period ends."}
        </AppText>
      </Card>

      <ActionButton
        size="large"
        title={
          busy ? "Saving…" : direction === "add" ? "Add funds" : "Reduce budget"
        }
        icon="checkmark"
        onPress={save}
        disabled={busy || !canSave}
        busy={busy}
      />

      <Card style={{ gap: 14 }}>
        <AppText variant="headline">Adjustments this period</AppText>
        {adjustments.map((item) => {
          const amountLabel = money(item.amountMinor, true);
          return (
            <View
              key={item.id}
              style={{
                gap: 6,
                paddingBottom: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText literal numeric variant="label">
                    {amountLabel}
                  </AppText>
                  <AppText
                    literal
                    variant="caption"
                    muted
                  >{`${item.date}${item.note ? ` · ${item.note}` : ""}`}</AppText>
                </View>
                <TextButton
                  title="Delete"
                  icon="trash"
                  tone="danger"
                  accessibilityLabel={t(`Delete adjustment ${amountLabel}`)}
                  onPress={() => remove(item)}
                  disabled={busy}
                />
              </View>
            </View>
          );
        })}
        {!adjustments.length ? (
          <AppText muted>No adjustments this period yet.</AppText>
        ) : null}
      </Card>
    </FormScreen>
  );
}
