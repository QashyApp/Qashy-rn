import { View } from "react-native";

import { CloseTo } from "@/components/navigation/close-to";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { QashySwitch } from "@/components/ui/qashy-switch";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { DateField } from "@/components/ui/date-field";
import { FormField } from "@/components/ui/form-field";
import { CategoryPicker } from "@/features/transactions/form/category-picker";
import { FormScreen } from "@/components/ui/form-screen";
import type { CategoryKind, RecurrenceUnit } from "@/domain/models";
import { AmountHero } from "@/components/finance/amount-hero";
import { ForeignFeeFields } from "@/features/transactions/form/foreign-fee-fields";
import { useQashyTheme } from "@/theme/theme";
import { isLocalDate, mediumDate } from "@/utils/date";
import {
  END_MODES,
  intervalHint,
} from "@/features/more/recurring/recurring-model";
import { useRecurringForm } from "@/features/more/recurring/use-recurring-form";

export function RecurringFormScreen() {
  const { space } = useQashyTheme();
  const {
    params,
    state,
    locale,
    t,
    existing,
    kind,
    setKind,
    title,
    setTitle,
    note,
    setNote,
    tagIds,
    amount,
    setAmount,
    accountId,
    setAccountId,
    categoryId,
    setCategoryId,
    unit,
    setUnit,
    interval,
    setInterval,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    endMode,
    occurrenceCount,
    setOccurrenceCount,
    autoPost,
    setAutoPost,
    active,
    setActive,
    foreignEnabled,
    setForeignEnabled,
    foreignCurrency,
    setForeignCurrency,
    foreignRate,
    setForeignRate,
    feeKind,
    setFeeKind,
    feeValue,
    setFeeValue,
    busy,
    rateStatus,
    amountTouched,
    setAmountTouched,
    account,
    accountChoices,
    categories,
    trimmedForeignCurrency,
    foreignCurrencyError,
    foreignRateError,
    foreignAppliedRate,
    fetchingRate,
    togglingRates,
    turnOnRates,
    feeError,
    foreignFeePreview,
    amountError,
    intervalError,
    startDateError,
    endDateError,
    occurrenceCountError,
    countedEndDate,
    missingEndDate,
    changeEndMode,
    canSave,
    toggleTag,
    save,
    deleting,
    remove,
  } = useRecurringForm();

  if (params.id && !existing && !deleting) return <CloseTo href="/more" />;

  return (
    <FormScreen contentContainerStyle={{ gap: space.lg, paddingBottom: 40 }}>
      <AmountHero
        currency={
          foreignEnabled && trimmedForeignCurrency
            ? trimmedForeignCurrency
            : (account?.currency ?? state.settings.baseCurrency)
        }
        value={amount}
        onChangeText={(next) => {
          setAmountTouched(true);
          setAmount(next);
        }}
        // No blur validation: leaving the empty, autofocused field (to pick an account first)
        // would pop "Amount is required" in and shift the form under the pointer mid-press.
        error={amountTouched || existing ? amountError : undefined}
      />
      <Card style={{ gap: space.lg }}>
        <View
          accessibilityLabel={t("Recurring transaction kind")}
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", gap: space.sm }}
        >
          {(["expense", "income"] as CategoryKind[]).map((item) => (
            <View key={item} style={{ flex: 1 }}>
              <ChoiceChip
                icon={item === "income" ? "arrow.down" : "arrow.up"}
                label={item[0].toUpperCase() + item.slice(1)}
                selected={kind === item}
                onPress={() => {
                  if (item === kind) return;
                  setKind(item);
                  setCategoryId("");
                }}
              />
            </View>
          ))}
        </View>
        <FormField
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Rent, salary, subscription…"
        />
        <AppText variant="label">Account</AppText>
        <View
          accessibilityLabel={t("Recurring account")}
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
        >
          {accountChoices.map((item) => (
            <ChoiceChip
              key={item.id}
              literal
              icon={item.icon}
              label={item.name}
              selected={accountId === item.id}
              onPress={() => {
                if (item.id === accountId) return;
                setAccountId(item.id);
                setForeignRate("");
              }}
            />
          ))}
        </View>
        <AppText variant="label">Category</AppText>
        <CategoryPicker
          label="Recurring category"
          categories={categories}
          categoryId={categoryId}
          onSelect={setCategoryId}
        />
        <FormField
          label="Note"
          value={note}
          onChangeText={setNote}
          placeholder="Optional context"
          multiline
          style={{ minHeight: 92, textAlignVertical: "top" }}
        />
        {state.tags.length ? (
          <>
            <AppText variant="label">Tags</AppText>
            <View
              accessibilityLabel={t("Recurring tags")}
              role="group"
              style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
            >
              {state.tags.map((tag) => (
                <ChoiceChip
                  mode="checkbox"
                  key={tag.id}
                  literal
                  label={tag.name}
                  selected={tagIds.includes(tag.id)}
                  onPress={() => toggleTag(tag.id)}
                />
              ))}
            </View>
          </>
        ) : null}
      </Card>

      {account ? (
        <Card style={{ gap: 14 }}>
          <ForeignFeeFields
            accountCurrency={account.currency}
            locale={locale}
            foreignEnabled={foreignEnabled}
            onToggleForeign={(enabled) => {
              setForeignEnabled(enabled);
              if (!enabled) setForeignRate("");
            }}
            foreignCurrency={foreignCurrency}
            onChangeForeignCurrency={setForeignCurrency}
            rateText={foreignRate}
            onChangeRateText={setForeignRate}
            appliedRate={foreignAppliedRate}
            fetchingRate={fetchingRate}
            onTurnOnRates={rateStatus.enabled ? undefined : turnOnRates}
            turningOnRates={togglingRates}
            rateOptional
            feeKind={feeKind}
            onChangeFeeKind={setFeeKind}
            feeValue={feeValue}
            onChangeFeeValue={setFeeValue}
            errors={{
              foreignCurrency: foreignCurrencyError,
              rate: foreignRateError,
              fee: feeError,
            }}
            preview={foreignFeePreview}
          />
        </Card>
      ) : null}

      <Card style={{ gap: space.lg }}>
        <AppText variant="label">Repeats</AppText>
        <View
          accessibilityLabel={t("Recurrence period")}
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
        >
          {(["day", "week", "month", "year"] as RecurrenceUnit[]).map(
            (item) => (
              <ChoiceChip
                key={item}
                icon="calendar"
                label={item[0].toUpperCase() + item.slice(1)}
                selected={unit === item}
                onPress={() => setUnit(item)}
              />
            ),
          )}
        </View>
        <FormField
          label="Every"
          value={interval}
          onChangeText={setInterval}
          keyboardType="number-pad"
          error={intervalError}
          hint={intervalHint(interval, unit)}
          required
        />
        <DateField
          label="Starts"
          value={startDate}
          onChange={setStartDate}
          error={startDateError}
          required
        />
        <View style={{ gap: space.sm }}>
          <AppText variant="label">Ends</AppText>
          <View
            accessibilityLabel={t("When the schedule ends")}
            accessibilityRole="radiogroup"
            style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
          >
            {END_MODES.map((option) => (
              <ChoiceChip
                key={option.value}
                icon={option.icon}
                label={option.label}
                selected={endMode === option.value}
                onPress={() => changeEndMode(option.value)}
              />
            ))}
          </View>
        </View>
        {endMode === "date" ? (
          <DateField
            label="End date"
            value={endDate}
            onChange={setEndDate}
            error={endDateError ?? missingEndDate}
            minimumDate={isLocalDate(startDate) ? startDate : undefined}
            required
          />
        ) : endMode === "count" ? (
          <FormField
            label="Number of times"
            value={occurrenceCount}
            onChangeText={setOccurrenceCount}
            keyboardType="number-pad"
            placeholder="12"
            error={occurrenceCountError}
            hint={
              countedEndDate
                ? `The last one is on ${mediumDate(countedEndDate, locale)}.`
                : "For a set number of payments, like an installment plan."
            }
            required
          />
        ) : null}
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.md,
          }}
        >
          <View style={{ flex: 1, gap: space.xxs }}>
            <AppText variant="label">Post automatically</AppText>
            <AppText variant="caption" muted>
              Off by default. Upcoming items wait for your review.
            </AppText>
          </View>
          <QashySwitch
            accessibilityLabel={t("Post automatically")}
            value={autoPost}
            onValueChange={setAutoPost}
          />
        </View>
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <View style={{ flex: 1, gap: space.xxs }}>
            <AppText variant="label">Schedule active</AppText>
            <AppText variant="caption" muted>
              Pause without deleting this schedule.
            </AppText>
          </View>
          <QashySwitch
            accessibilityLabel={t("Schedule active")}
            value={active}
            onValueChange={setActive}
          />
        </View>
      </Card>

      <ActionButton
        title={
          busy ? "Saving…" : existing ? "Save schedule" : "Create schedule"
        }
        icon="checkmark"
        size="large"
        onPress={save}
        disabled={busy || !canSave}
        busy={busy}
      />
      {existing ? (
        <ActionButton
          title="Delete schedule"
          icon="trash"
          variant="danger"
          onPress={remove}
          disabled={busy}
        />
      ) : null}
    </FormScreen>
  );
}
