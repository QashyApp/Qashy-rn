import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useFormSheet } from '@/components/navigation/use-form-sheet';
import { ActionButton } from '@/components/ui/action-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { ChoiceListField, type ChoiceListOption } from '@/components/ui/choice-list-field';
import { ColorSwatch } from '@/components/ui/color-swatch';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import { FRANKFURTER_UNSUPPORTED } from '@/data/exchange-rates/frankfurter';
import type { AccountType } from '@/domain/models';
import { currencyLabel } from '@/features/onboarding/steps/currency-step';
import { useLocalization } from '@/localization/localization';
import { useExchangeRateService, useExchangeRateStatus } from '@/providers/exchange-rate-provider';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useQashyTheme } from '@/theme/theme';
import { ACCENT_PRESETS, radius, space, toneColors } from '@/theme/tokens';
import { confirmDestructive, errorMessage, showError } from '@/utils/confirm';
import { validateCurrencyCode, validateMoneyInput } from '@/utils/form-validation';
import { hapticSuccess } from '@/utils/haptics';
import { minorToLocalizedDecimalString, parseMoney, SUPPORTED_CURRENCY_CODES } from '@/utils/money';

const COLORS = ACCENT_PRESETS.slice(0, 7);
const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = { checking: 'building.columns', cash: 'banknote', savings: 'leaf', credit: 'creditcard', wallet: 'wallet' };

export function AccountFormScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id?: string; returnTo?: string }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const existing = id ? state.accounts.find((item) => item.id === id) : undefined;
  const [expectedRevision] = useState(existing?.revision);
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'checking');
  const [currency, setCurrency] = useState(existing?.currency ?? state.settings.baseCurrency);
  const [opening, setOpening] = useState(existing ? minorToLocalizedDecimalString(existing.openingBalanceMinor, existing.currency, state.settings.locale) : '0');
  const [openingTouched, setOpeningTouched] = useState(false);
  const [color, setColor] = useState(existing?.color ?? theme.staticAccent);
  const [busy, setBusy] = useState(false);
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  const [togglingRates, setTogglingRates] = useState(false);
  const { closeToOwner, allowLeave } = useFormSheet({
    ownerRoute: '/more',
    values: { name, type, currency, opening, color },
  });
  const currencyLocked = !!existing && (
    state.transactions.some((item) => item.accountId === existing.id || item.destinationAccountId === existing.id) ||
    state.recurringRules.some((item) => item.template.accountId === existing.id)
  );
  const currencyOptions = useMemo<ChoiceListOption[]>(() => [...SUPPORTED_CURRENCY_CODES]
    .map((code) => ({ value: code, label: currencyLabel(code, state.settings.locale), description: code }))
    .sort((a, b) => a.label.localeCompare(b.label, state.settings.locale)), [state.settings.locale]);
  const currencyError = validateCurrencyCode(currency);
  const openingError = currencyError
    ? undefined
    : validateMoneyInput(opening, currency, state.settings.locale, { label: 'Opening balance' });
  const canSave = !currencyError && !openingError;
  const currencyCode = currency.trim().toUpperCase();
  const showRatesCard = !currencyError && !rateStatus.enabled && currencyCode !== state.settings.baseCurrency;
  const currencyUnsupported = showRatesCard && FRANKFURTER_UNSUPPORTED.has(currencyCode);

  const turnOnAutomaticRates = async () => {
    if (togglingRates) return;
    setTogglingRates(true);
    try {
      await exchangeRateService.setEnabled(true);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that this account's currency may have just gotten one.
      await repository.generateRecurring();
    } catch (reason) {
      showError('Couldn’t turn on automatic rates', errorMessage(reason, 'Try again.'));
    } finally {
      setTogglingRates(false);
    }
  };

  const changeCurrency = (value: string) => {
    setCurrency(value);
    // An untouched opening balance keeps representing the stored minor amount
    // instead of being silently reinterpreted under the new currency's digits.
    if (existing && !openingTouched && /^[A-Za-z]{3}$/.test(value)) {
      try {
        setOpening(minorToLocalizedDecimalString(existing.openingBalanceMinor, value.toUpperCase(), state.settings.locale));
      } catch {
        // Unknown currency code while typing; leave the field as-is.
      }
    }
  };

  const save = async () => {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      await repository.saveAccount({ name: name.trim() || t('Account'), type, currency: currency.toUpperCase(), openingBalanceMinor: parseMoney(opening, currency, state.settings.locale), icon: 'wallet.bifold', color, archived: false }, existing?.id, expectedRevision);
      hapticSuccess();
      if (!existing && returnTo === '/transaction' && router.canGoBack()) {
        // Returning to the transaction sheet that opened this one, not to a section.
        allowLeave();
        router.back();
      } else closeToOwner();
    } catch (reason) {
      showError('Couldn’t save account', errorMessage(reason, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!existing || busy) return;
    if (!(await confirmDestructive({ title: `Archive ${existing.name}?`, message: 'The account is hidden from lists and pickers, but any balance it holds still counts toward your totals. You can restore it from the Archived section in More.', confirmLabel: 'Archive' }))) return;
    setBusy(true);
    try {
      await repository.saveAccount({ ...existing, archived: true }, existing.id, expectedRevision);
      closeToOwner();
    } catch (reason) {
      showError('Couldn’t archive account', errorMessage(reason, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (id && !existing) return <Redirect href="/more" />;

  const preview = toneColors(color, theme.staticSurface, theme.staticText, theme.mode === 'dark');

  return (
    <FormScreen contentContainerStyle={{ gap: 16 }}>
      {/* A hero preview of the tinted, raised tile this account will show everywhere else
          (More's account list, transaction rows, the picker) — the same `toneColors` derivation
          those rows use, so choosing an account color here previews exactly what it becomes. */}
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.card,
            borderCurve: 'continuous',
            backgroundColor: preview.container,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: theme.shadowRaised,
          }}>
          <AppIcon name={ACCOUNT_TYPE_ICONS[type]} color={preview.onContainer} size={32} />
        </View>
        {name.trim() ? <AppText literal variant="headline" numberOfLines={1}>{name}</AppText> : null}
      </View>
      <Card style={{ gap: 16 }}>
        <FormField label="Account name" value={name} onChangeText={setName} placeholder="Everyday" autoFocus={!existing} />
        <AppText variant="label">Type</AppText>
        <View accessibilityLabel={t('Account type')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{(['checking', 'cash', 'savings', 'credit', 'wallet'] as AccountType[]).map((item) => <ChoiceChip key={item} icon={ACCOUNT_TYPE_ICONS[item]} label={item[0].toUpperCase() + item.slice(1)} selected={type === item} onPress={() => setType(item)} />)}</View>
        {currencyLocked ? (
        <FormField label="Currency" value={currency} onChangeText={changeCurrency} maxLength={3} autoCapitalize="characters" editable={!currencyLocked} error={currencyLocked ? undefined : currencyError} hint={currencyLocked ? 'Currency is locked because this account has transaction or schedule history.' : undefined} required />
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
        <FormField label="Opening balance" value={opening} onChangeText={(value) => { setOpeningTouched(true); setOpening(value); }} keyboardType="decimal-pad" error={openingError} hint="Changing this adjusts the derived account balance." required />
        <AppText variant="label">Color</AppText>
        <View accessibilityLabel={t('Account color')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>{COLORS.map((item) => <ColorSwatch key={item} color={item} selected={color === item} label={`Use ${item} account color`} onPress={() => setColor(item)} />)}</View>
      </Card>
      {showRatesCard ? (
        <Card variant="inset" style={{ gap: 12 }}>
          {currencyUnsupported ? (
            <AppText literal variant="caption" muted>{`Automatic rates aren’t available for ${currencyCode}; add rates manually.`}</AppText>
          ) : (
            <>
              <AppText literal variant="caption" muted>{`Qashy can fetch ${currencyCode} rates automatically from frankfurter.dev. Only currency codes and dates are sent.`}</AppText>
              <ActionButton title={togglingRates ? 'Turning on…' : 'Turn on'} variant="secondary" busy={togglingRates} disabled={togglingRates} onPress={turnOnAutomaticRates} />
            </>
          )}
        </Card>
      ) : null}
      <ActionButton title={busy ? 'Saving…' : existing ? 'Save account' : 'Create account'} icon="checkmark" size="large" onPress={save} disabled={busy || !canSave} busy={busy} />
      {existing && state.accounts.filter((item) => !item.archived).length > 1 ? <ActionButton title="Archive account" variant="danger" onPress={archive} disabled={busy} /> : null}
      {existing && state.accounts.filter((item) => !item.archived).length <= 1 ? <AppText variant="caption" muted>This is your only account, so it can’t be archived. Add another account first.</AppText> : null}
    </FormScreen>
  );
}
