import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { CloseTo } from "@/components/navigation/close-to";
import { useFormSheet } from "@/components/navigation/use-form-sheet";
import { ActionButton } from "@/components/ui/action-button";
import { IconBadge } from "@/components/ui/icon-badge";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import {
  ChoiceListField,
  type ChoiceListOption,
} from "@/components/ui/choice-list-field";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { MoneyField } from "@/components/finance/money-field";
import { FormField } from "@/components/ui/form-field";
import { FormScreen } from "@/components/ui/form-screen";
import { FRANKFURTER_UNSUPPORTED } from "@/data/exchange-rates/frankfurter";
import type { AccountType } from "@/domain/models";
import { currencyLabel } from "@/features/onboarding/steps/currency-step";
import { useLocalization } from "@/localization/localization";
import {
  useExchangeRateService,
  useExchangeRateStatus,
} from "@/providers/exchange-rate-provider";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { ACCENT_PRESETS } from "@/theme/tokens";
import { accountDeletionMessage } from "@/utils/account-impact";
import { accountTypeLabel } from "@/utils/labels";
import { useTurnOnAutomaticRates } from "@/features/use-automatic-rates";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import {
  validateCurrencyCode,
  validateMoneyInput,
} from "@/utils/form-validation";
import { hapticSuccess } from "@/utils/haptics";
import {
  minorToLocalizedDecimalString,
  parseMoney,
  SUPPORTED_CURRENCY_CODES,
} from "@/utils/money";

const COLORS = ACCENT_PRESETS.slice(0, 7);
const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  checking: "building.columns",
  cash: "banknote",
  savings: "leaf",
  credit: "creditcard",
  wallet: "wallet",
};

export function AccountFormScreen() {
  const { id, returnTo } = useLocalSearchParams<{
    id?: string;
    returnTo?: string;
  }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const { locale, t } = useLocalization();
  const existing = id
    ? state.accounts.find((item) => item.id === id)
    : undefined;
  const [expectedRevision] = useState(existing?.revision);
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<AccountType>(existing?.type ?? "checking");
  const [currency, setCurrency] = useState(
    existing?.currency ?? state.settings.baseCurrency,
  );
  const [opening, setOpening] = useState(
    existing
      ? minorToLocalizedDecimalString(
          existing.openingBalanceMinor,
          existing.currency,
          locale,
        )
      : "0",
  );
  const [openingTouched, setOpeningTouched] = useState(false);
  const [color, setColor] = useState(existing?.color ?? theme.staticAccent);
  const [busy, setBusy] = useState(false);
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  const { closeToOwner, allowLeave } = useFormSheet({
    ownerRoute: "/more",
    values: { name, type, currency, opening, color },
  });
  const currencyLocked =
    !!existing &&
    (state.transactions.some(
      (item) =>
        item.accountId === existing.id ||
        item.destinationAccountId === existing.id,
    ) ||
      state.recurringRules.some(
        (item) => item.template.accountId === existing.id,
      ));
  const currencyOptions = useMemo<ChoiceListOption[]>(
    () =>
      [...SUPPORTED_CURRENCY_CODES]
        .map((code) => ({
          value: code,
          label: currencyLabel(code, locale),
          description: code,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [locale],
  );
  const currencyError = validateCurrencyCode(currency);
  const openingError = currencyError
    ? undefined
    : validateMoneyInput(opening, currency, locale, {
        label: "Opening balance",
      });
  const canSave = !currencyError && !openingError;
  const currencyCode = currency.trim().toUpperCase();
  const showRatesCard =
    !currencyError &&
    !rateStatus.enabled &&
    currencyCode !== state.settings.baseCurrency;
  const currencyUnsupported =
    showRatesCard && FRANKFURTER_UNSUPPORTED.has(currencyCode);

  const { turningOn: togglingRates, turnOn: turnOnAutomaticRates } =
    useTurnOnAutomaticRates();

  const changeCurrency = (value: string) => {
    setCurrency(value);
    // An untouched opening balance keeps representing the stored minor amount
    // instead of being silently reinterpreted under the new currency's digits.
    if (existing && !openingTouched && /^[A-Za-z]{3}$/.test(value)) {
      try {
        setOpening(
          minorToLocalizedDecimalString(
            existing.openingBalanceMinor,
            value.toUpperCase(),
            locale,
          ),
        );
      } catch {
        // Unknown currency code while typing; leave the field as-is.
      }
    }
  };

  const save = async () => {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      await repository.saveAccount(
        {
          name: name.trim() || t("Account"),
          type,
          currency: currency.toUpperCase(),
          openingBalanceMinor: parseMoney(opening, currency, locale),
          icon: "wallet.bifold",
          color,
          archived: false,
        },
        existing?.id,
        expectedRevision,
      );
      hapticSuccess();
      // Fire-and-forget: a new foreign account gets today's rate so its balance converts right
      // away. Never blocks or fails the save.
      exchangeRateService.ensureRatesForPending().catch(() => undefined);
      if (!existing && returnTo === "/transaction" && router.canGoBack()) {
        // Returning to the transaction sheet that opened this one, not to a section.
        allowLeave();
        router.back();
      } else closeToOwner();
    } catch (reason) {
      showError("Couldn’t save account", errorMessage(reason, "Try again."));
    } finally {
      setBusy(false);
    }
  };

  // True while this screen is deleting its own record. The delete drops `existing` from the
  // snapshot before `closeToOwner` runs; without this the "gone" branch below would dismiss the
  // sheet at once: no exit animation, and the discard prompt on a dirty form.
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!existing || busy) return;
    if (
      !(await confirmDestructive({
        title: `Delete ${existing.name}?`,
        message: accountDeletionMessage(state, [existing.id]),
      }))
    )
      return;
    setBusy(true);
    setDeleting(true);
    try {
      await repository.deleteEntities("accounts", [existing.id]);
      // The form is done: leaving after a delete must never ask to discard changes.
      allowLeave();
      closeToOwner();
    } catch (reason) {
      // Only a failed delete frees the form again; after a success it stays locked while the sheet exits.
      setDeleting(false);
      setBusy(false);
      showError("Couldn’t delete account", errorMessage(reason, "Try again."));
    }
  };

  if (id && !existing && !deleting) return <CloseTo href="/more" />;

  return (
    <FormScreen contentContainerStyle={{ gap: space.lg }}>
      {/* A hero preview of the tinted, raised tile this account will show everywhere else
          (More's account list, transaction rows, the picker) — the same `toneColors` derivation
          those rows use, so choosing an account color here previews exactly what it becomes. */}
      <View
        style={{
          alignItems: "center",
          gap: space.sm,
          paddingVertical: space.sm,
        }}
      >
        <IconBadge
          icon={ACCOUNT_TYPE_ICONS[type]}
          color={color}
          fallback={{
            container: theme.accentContainer,
            onContainer: theme.onAccentContainer,
          }}
          size={72}
          iconSize={32}
        />
        {name.trim() ? (
          <AppText literal variant="headline" numberOfLines={1}>
            {name}
          </AppText>
        ) : null}
      </View>
      <Card style={{ gap: space.lg }}>
        <FormField
          label="Account name"
          value={name}
          onChangeText={setName}
          placeholder="Everyday"
          autoFocus={!existing}
        />
        <AppText variant="label">Type</AppText>
        <View
          accessibilityLabel={t("Account type")}
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
        >
          {(
            ["checking", "cash", "savings", "credit", "wallet"] as AccountType[]
          ).map((item) => (
            <ChoiceChip
              key={item}
              icon={ACCOUNT_TYPE_ICONS[item]}
              label={accountTypeLabel(item)}
              selected={type === item}
              onPress={() => setType(item)}
            />
          ))}
        </View>
        {currencyLocked ? (
          <FormField
            label="Currency"
            value={currency}
            onChangeText={changeCurrency}
            maxLength={3}
            autoCapitalize="characters"
            editable={!currencyLocked}
            error={currencyLocked ? undefined : currencyError}
            hint={
              currencyLocked
                ? "Currency is locked because this account has transaction or schedule history."
                : undefined
            }
            required
          />
        ) : (
          <ChoiceListField
            label="Currency"
            value={currency.toUpperCase()}
            options={currencyOptions}
            onChange={changeCurrency}
            searchable
            literalOptions
            searchPlaceholder="Search by currency name or code"
          />
        )}
        <MoneyField
          currency={currencyCode}
          label="Opening balance"
          value={opening}
          onChangeText={(value) => {
            setOpeningTouched(true);
            setOpening(value);
          }}
          error={openingError}
          hint={
            existing
              ? "Changing this adjusts the derived account balance."
              : undefined
          }
          required
        />
        <AppText variant="label">Color</AppText>
        <View
          accessibilityLabel={t("Account color")}
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}
        >
          {COLORS.map((item) => (
            <ColorSwatch
              key={item}
              color={item}
              selected={color === item}
              label={`Use ${item} account color`}
              onPress={() => setColor(item)}
            />
          ))}
        </View>
      </Card>
      {showRatesCard ? (
        <Card variant="inset" style={{ gap: space.md }}>
          {currencyUnsupported ? (
            <AppText
              variant="caption"
              muted
            >{`Automatic rates aren’t available for ${currencyCode}; add rates manually.`}</AppText>
          ) : (
            <>
              <AppText
                variant="caption"
                muted
              >{`Qashy can fetch ${currencyCode} rates automatically from frankfurter.dev. Only currency codes and dates are sent.`}</AppText>
              <ActionButton
                title={togglingRates ? "Turning on…" : "Turn on"}
                variant="secondary"
                busy={togglingRates}
                disabled={togglingRates}
                onPress={turnOnAutomaticRates}
              />
            </>
          )}
        </Card>
      ) : null}
      <ActionButton
        title={busy ? "Saving…" : existing ? "Save account" : "Create account"}
        icon="checkmark"
        size="large"
        onPress={save}
        disabled={busy || !canSave}
        busy={busy}
      />
      {existing &&
      state.accounts.filter((item) => !item.archived).length > 1 ? (
        <ActionButton
          title="Delete account"
          icon="trash"
          variant="danger"
          onPress={remove}
          disabled={busy}
        />
      ) : null}
      {existing &&
      state.accounts.filter((item) => !item.archived).length <= 1 ? (
        <AppText variant="caption" muted>
          This is your only account, so it can’t be deleted. Add another account
          first.
        </AppText>
      ) : null}
    </FormScreen>
  );
}
