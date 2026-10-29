import { router } from "expo-router";
import { View } from "react-native";

import { CloseTo } from "@/components/navigation/close-to";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { MoneyField } from "@/components/finance/money-field";
import { DateField } from "@/components/ui/date-field";
import { FormField } from "@/components/ui/form-field";
import { FormScreen } from "@/components/ui/form-screen";
import { MotionView } from "@/components/ui/motion";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextButton } from "@/components/ui/text-button";
import type { Account } from "@/domain/models";
import { AmountHero } from "@/components/finance/amount-hero";
import { CategoryPicker } from "@/features/transactions/form/category-picker";
import { ForeignFeeFields } from "@/features/transactions/form/foreign-fee-fields";
import { MoreDetails } from "@/features/transactions/form/more-details";
import { useQashyTheme } from "@/theme/theme";
import { mediumDate } from "@/utils/date";
import { stashRecurringDraft } from "@/features/more/recurring-draft";
import { localizeDecimalString } from "@/utils/money";
import { useTransactionForm } from "@/features/transactions/form/use-transaction-form";

const KIND_OPTIONS = [
  { value: "expense" as const, label: "Expense", icon: "arrow.up" },
  { value: "income" as const, label: "Income", icon: "arrow.down" },
  {
    value: "transfer" as const,
    label: "Transfer",
    icon: "arrow.left.arrow.right",
  },
];

const accountChipLabel = (
  item: Pick<Account, "name" | "currency" | "archived">,
  t: (key: string) => string,
) =>
  `${item.name} · ${item.currency}${item.archived ? ` ${t("(archived)")}` : ""}`;

export function TransactionFormScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const {
    id,
    returnTo,
    state,
    locale,
    t,
    existing,
    kind,
    setKind,
    title,
    setTitle,
    amountTouched,
    setAmountTouched,
    amountInput,
    setAmountInput,
    date,
    accountId,
    setAccountId,
    destinationAccountId,
    setDestinationAccountId,
    categoryId,
    setCategoryId,
    categoryTouched,
    setCategoryTouched,
    suggestedCategoryFor,
    tagIds,
    note,
    setNote,
    exchangeRate,
    setExchangeRate,
    destinationAmount,
    setDestinationAmount,
    foreignEnabled,
    setForeignEnabled,
    foreignCurrency,
    setForeignCurrency,
    foreignRate,
    setForeignRate,
    setExchangeRateEdited,
    setForeignRateEdited,
    typeExchangeRate,
    typeForeignRate,
    changeDate,
    feeKind,
    setFeeKind,
    feeValue,
    setFeeValue,
    busy,
    rateStatus,
    rateOverrideOpen,
    setRateOverrideOpen,
    saveError,
    account,
    destinationAccount,
    categories,
    needsRate,
    appliedRate,
    destinationChoices,
    accountChoices,
    foreignActive,
    trimmedForeignCurrency,
    foreignCurrencyError,
    foreignRateError,
    amountExpression,
    amount,
    amountPending,
    resolveAmount,
    foreignAppliedRate,
    feeError,
    foreignFeePreview,
    amountError,
    dateError,
    sameCurrencyTransfer,
    destinationAmountError,
    exchangeRateError,
    destinationError,
    moreOpen,
    setMoreOpen,
    fetchingRate,
    togglingRates,
    turnOnRates,
    rateMissingMessage,
    canSave,
    ownerRoute,
    allowLeave,
    toggleTag,
    save,
    deleting,
    remove,
  } = useTransactionForm();

  if (id && !existing && !deleting) {
    return (
      <CloseTo
        href={returnTo === "/overview" ? "/overview" : "/transactions"}
      />
    );
  }

  return (
    <FormScreen>
      <SegmentedControl
        label="Transaction kind"
        value={kind}
        options={KIND_OPTIONS}
        onChange={(next) => {
          setKind(next);
          setCategoryId(
            categoryTouched ? "" : suggestedCategoryFor(title, next),
          );
        }}
      />

      <AmountHero
        currency={
          foreignActive && trimmedForeignCurrency
            ? trimmedForeignCurrency
            : (account?.currency ?? state.settings.baseCurrency)
        }
        value={amountInput}
        onChangeText={(next) => {
          setAmountTouched(true);
          setAmountInput(next);
        }}
        // Enter on a hardware keyboard finishes a calculation the way the keypad's result key does.
        onSubmitEditing={() => {
          const resolved = resolveAmount(amountInput);
          if (resolved !== null) setAmountInput(resolved);
        }}
        calculator="expression"
        // No blur validation: leaving the empty, autofocused field (to pick an account first)
        // would pop "Amount is required" in and shift the form under the pointer mid-press.
        error={
          (amountTouched || existing) && !amountPending
            ? amountError
            : undefined
        }
        autoFocus={!existing}
      />

      {amountExpression.kind === "value" ? (
        <AppText
          literal
          variant="caption"
          muted
          style={{ textAlign: "center" }}
        >
          {`= ${amountExpression.text}`}
        </AppText>
      ) : null}

      <Card style={{ gap: space.lg }}>
        <FormField
          label="Title"
          value={title}
          onChangeText={(next) => {
            setTitle(next);
            if (!categoryTouched)
              setCategoryId(suggestedCategoryFor(next, kind));
          }}
          placeholder={kind === "transfer" ? "Transfer" : "What was it?"}
        />
      </Card>

      {kind !== "transfer" ? (
        // Arrives and leaves with the kind (a transfer has no category), instead of popping.
        <MotionView variant="up" exit>
          <Card style={{ gap: space.md }}>
            <AppText variant="label">Category</AppText>
            <CategoryPicker
              categories={categories}
              categoryId={categoryId}
              onSelect={(next) => {
                setCategoryTouched(true);
                setCategoryId(next);
              }}
            />
            {!categoryTouched && categoryId ? (
              <AppText variant="caption" muted>
                Suggested from earlier transactions with this title.
              </AppText>
            ) : null}
          </Card>
        </MotionView>
      ) : null}

      <Card style={{ gap: space.md }}>
        <AppText variant="label">From account</AppText>
        <View
          accessibilityLabel={t("From account")}
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
        >
          {accountChoices.map((item) => (
            <ChoiceChip
              key={item.id}
              literal
              icon={item.icon}
              label={accountChipLabel(item, t)}
              disabled={item.archived}
              selected={accountId === item.id}
              onPress={() => {
                if (item.id === accountId) return;
                setAccountId(item.id);
                setExchangeRate("");
                setExchangeRateEdited(false);
                setForeignRateEdited(false);
                setRateOverrideOpen(false);
                setDestinationAmount("");
                setForeignRate("");
                if (destinationAccountId === item.id)
                  setDestinationAccountId("");
              }}
            />
          ))}
        </View>
        {kind === "transfer" ? (
          <>
            <AppText variant="label">To account</AppText>
            {destinationChoices.length ? (
              <View
                accessibilityLabel={t("To account")}
                accessibilityRole="radiogroup"
                style={{
                  flexDirection: "row",
                  gap: space.sm,
                  flexWrap: "wrap",
                }}
              >
                {destinationChoices.map((item) => (
                  <ChoiceChip
                    key={item.id}
                    literal
                    icon={item.icon}
                    label={accountChipLabel(item, t)}
                    disabled={item.archived}
                    selected={destinationAccountId === item.id}
                    onPress={() => {
                      if (item.id === destinationAccountId) return;
                      setDestinationAccountId(item.id);
                      setDestinationAmount("");
                    }}
                  />
                ))}
              </View>
            ) : (
              <View
                role="alert"
                style={{
                  gap: space.sm,
                  padding: space.lg,
                  borderRadius: theme.radius.control,
                  backgroundColor: theme.surfaceMuted,
                }}
              >
                <AppText variant="label">Transfers need two accounts</AppText>
                <AppText variant="caption" muted>
                  Add another account, then return here to finish this transfer.
                  Your draft will stay open.
                </AppText>
                <ActionButton
                  title="Add another account"
                  variant="secondary"
                  onPress={() =>
                    router.push({
                      pathname: "/account",
                      params: { returnTo: "/transaction" },
                    })
                  }
                />
              </View>
            )}
            {destinationError && destinationChoices.length ? (
              <AppText variant="caption" muted>
                {destinationError}
              </AppText>
            ) : null}
            {destinationAccount && !sameCurrencyTransfer ? (
              <MoneyField
                currency={destinationAccount.currency}
                label={`Destination amount (${destinationAccount.currency})`}
                value={destinationAmount}
                onChangeText={setDestinationAmount}
                placeholder="Calculated automatically"
                error={destinationAmountError}
                hint="Leave blank to calculate through your automatic or manual exchange rates."
              />
            ) : sameCurrencyTransfer ? (
              <AppText variant="caption" muted>
                The destination receives the same amount; same-currency
                transfers always conserve value.
              </AppText>
            ) : null}
          </>
        ) : null}
      </Card>

      {kind !== "transfer" && account ? (
        <Card style={{ gap: space.md }}>
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
            onChangeRateText={typeForeignRate}
            appliedRate={foreignAppliedRate}
            fetchingRate={fetchingRate}
            onTurnOnRates={rateStatus.enabled ? undefined : turnOnRates}
            turningOnRates={togglingRates}
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

      <Card style={{ gap: space.md }}>
        <MoreDetails
          expanded={moreOpen}
          onToggle={() => setMoreOpen((open) => !open)}
        >
          <DateField
            label="Date"
            value={date}
            onChange={changeDate}
            error={dateError}
            required
          />

          {state.tags.length && kind !== "transfer" ? (
            <View style={{ gap: space.md }}>
              <AppText variant="label">Tags</AppText>
              <View
                accessibilityLabel={t("Transaction tags")}
                role="group"
                style={{
                  flexDirection: "row",
                  gap: space.sm,
                  flexWrap: "wrap",
                }}
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
            </View>
          ) : null}

          {needsRate && account ? (
            <View style={{ gap: space.md }}>
              {appliedRate ? (
                <AppText literal variant="caption" muted>
                  {`1 ${account.currency} = ${localizeDecimalString(appliedRate.rate, locale)} ${state.settings.baseCurrency} · ${mediumDate(appliedRate.effectiveDate, locale)} · ${appliedRate.automatic ? t("Automatic") : t("Manual")}`}
                </AppText>
              ) : fetchingRate ? (
                <AppText variant="caption" muted>
                  Fetching rate…
                </AppText>
              ) : (
                <View style={{ gap: space.sm }}>
                  <AppText variant="caption" muted>
                    No rate for this date.
                  </AppText>
                  {!rateStatus.enabled ? (
                    <TextButton
                      title={
                        togglingRates
                          ? "Turning on…"
                          : "Turn on automatic rates"
                      }
                      disabled={togglingRates}
                      onPress={turnOnRates}
                      style={{ alignSelf: "flex-start" }}
                    />
                  ) : null}
                </View>
              )}
              <TextButton
                title={
                  rateOverrideOpen
                    ? "Hide rate override"
                    : "Use a different rate"
                }
                tone="muted"
                onPress={() => setRateOverrideOpen((open) => !open)}
                style={{ alignSelf: "flex-start" }}
              />
              {rateOverrideOpen ? (
                <FormField
                  label={`1 ${account.currency} equals how many ${state.settings.baseCurrency}?`}
                  value={exchangeRate}
                  onChangeText={typeExchangeRate}
                  keyboardType="decimal-pad"
                  placeholder="Use the applied rate above"
                  error={exchangeRateError}
                  hint="Leave blank to use the applied rate above. The applied rate is snapshotted."
                />
              ) : null}
            </View>
          ) : null}

          <FormField
            label="Note"
            value={note}
            onChangeText={setNote}
            placeholder="Optional context"
            multiline
            style={{ minHeight: 92, textAlignVertical: "top" }}
          />
          {!existing && kind !== "transfer" ? (
            <TextButton
              title="Make this recurring instead"
              onPress={() => {
                allowLeave();
                router.push({
                  pathname: "/recurring",
                  params: {
                    returnTo: ownerRoute,
                    draftId: stashRecurringDraft({
                      kind,
                      title,
                      amount,
                      accountId,
                      categoryId,
                      foreignCurrency: foreignActive
                        ? trimmedForeignCurrency
                        : undefined,
                      feeKind,
                      feeValue,
                    }),
                  },
                });
              }}
              style={{ alignSelf: "flex-start" }}
            />
          ) : null}
        </MoreDetails>
      </Card>

      {rateMissingMessage || saveError ? (
        <AppText
          accessibilityRole="alert"
          variant="caption"
          style={{ color: theme.negativeText }}
        >
          {rateMissingMessage ?? saveError}
        </AppText>
      ) : null}
      <ActionButton
        title={busy ? "Saving…" : existing ? "Save changes" : "Add transaction"}
        icon="checkmark"
        size="large"
        onPress={save}
        disabled={busy || !canSave}
        busy={busy}
      />
      {existing ? (
        <ActionButton
          title="Delete transaction"
          icon="trash"
          variant="danger"
          onPress={remove}
          disabled={busy}
        />
      ) : null}
    </FormScreen>
  );
}
