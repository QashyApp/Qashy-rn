import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";

import { useFormSheet } from "@/components/navigation/use-form-sheet";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { FormField } from "@/components/ui/form-field";
import { FormScreen } from "@/components/ui/form-screen";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { todayLocal } from "@/utils/date";
import {
  validateCurrencyCode,
  validateDateInput,
  validateExchangeRate,
} from "@/utils/form-validation";
import { hapticSuccess } from "@/services/haptics";
import { localizeDecimalString, normalizeDecimalString } from "@/utils/money";

export function ExchangeRateScreen() {
  const { id, currency, returnTo } = useLocalSearchParams<{
    id?: string;
    currency?: string;
    returnTo?: string;
  }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { locale } = useLocalization();
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const existing = id
    ? state.exchangeRates.find((item) => item.id === id)
    : undefined;
  const [expectedRevision] = useState(existing?.revision);
  // `currency` arrives from the "Needs a manual rate" list on the Exchange rates screen
  // (an unsupported currency or a conflict) — a convenience prefill, not a lookup key.
  const [fromCurrency, setFromCurrency] = useState(
    existing?.fromCurrency ?? currency?.toUpperCase() ?? "EUR",
  );
  const [rate, setRate] = useState(() =>
    existing?.rate ? localizeDecimalString(existing.rate, locale) : "",
  );
  const [effectiveDate, setEffectiveDate] = useState(
    existing?.effectiveDate ?? todayLocal(),
  );
  const [saving, setSaving] = useState(false);
  const { closeToOwner, allowLeave } = useFormSheet({
    ownerRoute: "/more",
    values: { fromCurrency, rate, effectiveDate },
  });
  // Reached from the Exchange rates screen's own lists, not only from More directly. Going
  // back there instead of all the way to More keeps the list (and whatever else still needs a
  // manual rate) in view after a save or delete.
  const finish = () => {
    if (returnTo === "/exchange-rates" && router.canGoBack()) {
      allowLeave();
      router.back();
      return;
    }
    closeToOwner();
  };
  const currencyError =
    validateCurrencyCode(fromCurrency) ??
    (fromCurrency.toUpperCase() === state.settings.baseCurrency
      ? `Choose a currency other than ${state.settings.baseCurrency}.`
      : undefined);
  const rateError = validateExchangeRate(rate, locale);
  const dateError = validateDateInput(effectiveDate, {
    label: "Effective date",
  });
  const canSave = !currencyError && !rateError && !dateError;
  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      await repository.saveExchangeRate(
        {
          fromCurrency: fromCurrency.toUpperCase(),
          toCurrency: state.settings.baseCurrency,
          rate: normalizeDecimalString(rate, locale),
          effectiveDate,
        },
        existing?.id,
        expectedRevision,
      );
      hapticSuccess();
      finish();
    } catch (reason) {
      showError(
        "Couldn’t save rate",
        errorMessage(reason, "Check the form and try again."),
      );
    } finally {
      setSaving(false);
    }
  };
  // True while this screen is deleting its own record. The delete drops `existing` from the
  // snapshot before `finish` runs; without this the "gone" redirect below would leave at once,
  // ahead of `finish` (and its return to the list the user came from).
  const [deleting, setDeleting] = useState(false);
  // A second tap while the confirmation is still open must not open another.
  const confirming = useRef(false);
  const remove = async () => {
    if (!existing || saving || confirming.current) return;
    confirming.current = true;
    let confirmed: boolean;
    try {
      confirmed = await confirmDestructive({
        title: `Delete the ${existing.fromCurrency} rate?`,
        message: "Transactions that need this rate will report it as missing.",
      });
    } finally {
      confirming.current = false;
    }
    if (!confirmed) return;
    setSaving(true);
    setDeleting(true);
    try {
      await repository.deleteEntities("exchangeRates", [existing.id]);
      // The form is done: leaving after a delete must never ask to discard changes.
      allowLeave();
      finish();
    } catch (reason) {
      // Only a failed delete frees the form again; after a success it stays locked while it exits.
      setDeleting(false);
      setSaving(false);
      showError("Couldn’t delete rate", errorMessage(reason, "Try again."));
    }
  };
  if (id && !existing && !deleting)
    return (
      <Redirect
        href={returnTo === "/exchange-rates" ? "/exchange-rates" : "/more"}
      />
    );

  return (
    <FormScreen maxWidth={620} contentContainerStyle={{ gap: space.lg }}>
      {/* A hero read-out of the pair being defined, in the same sunken-well material as a
          numeric hero field, so the rate this form edits reads as the primary subject rather
          than one of three equally weighted fields. */}
      <View
        style={{
          ...materialStyle(theme, "sunken"),
          borderRadius: radius.sheet,
          borderCurve: "continuous",
          paddingVertical: space.xl,
          paddingHorizontal: space.xl,
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <AppText
          literal
          variant="overline"
          muted
        >{`${fromCurrency.toUpperCase() || "—"} → ${state.settings.baseCurrency}`}</AppText>
        <AppText literal figure variant="display">
          {rate || "—"}
        </AppText>
      </View>
      <Card style={{ gap: space.lg }}>
        <FormField
          label="From currency"
          value={fromCurrency}
          onChangeText={setFromCurrency}
          autoCapitalize="characters"
          maxLength={3}
          error={currencyError}
          required
        />
        <FormField
          label={`1 ${fromCurrency.toUpperCase()} equals how many ${state.settings.baseCurrency}?`}
          value={rate}
          onChangeText={setRate}
          keyboardType="decimal-pad"
          error={rateError}
          required
        />
        <DateField
          label="Effective date"
          value={effectiveDate}
          onChange={setEffectiveDate}
          error={dateError}
          required
        />
      </Card>
      <ActionButton
        title={saving && !deleting ? "Saving…" : "Save rate"}
        icon="checkmark"
        size="large"
        onPress={save}
        disabled={saving || !canSave}
        busy={saving && !deleting}
      />
      {existing ? (
        <ActionButton
          title="Delete rate"
          icon="trash"
          variant="danger"
          onPress={remove}
          disabled={saving}
          busy={deleting}
        />
      ) : null}
    </FormScreen>
  );
}
