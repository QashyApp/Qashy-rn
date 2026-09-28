import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { QashySwitch } from '@/components/ui/qashy-switch';
import { ChoiceListField, type ChoiceListOption } from '@/components/ui/choice-list-field';
import { FormField } from '@/components/ui/form-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextButton } from '@/components/ui/text-button';
import { currencyLabel } from '@/features/onboarding/steps/currency-step';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { mediumDate } from '@/utils/date';
import { formatMoney, localizeDecimalString, SUPPORTED_CURRENCY_CODES } from '@/utils/money';
import type { AppliedRate } from '@/utils/rates';

export type ForeignFeeKind = 'none' | 'percent' | 'fixed';

export interface ForeignFeePreview {
  principalMinor: number | null;
  feeMinor: number | null;
  totalMinor: number | null;
  kind: 'expense' | 'income';
}

export interface ForeignFeeFieldsErrors {
  foreignCurrency?: string;
  rate?: string;
  fee?: string;
}

/**
 * Shared "paid in another currency" + "extra fee" controls for the
 * transaction and recurring-schedule forms. Fully controlled/presentational:
 * every value and change handler comes from the caller, which also owns the
 * conversion/fee math and passes back a `preview` to render as a breakdown
 * caption. Nothing here is hidden away for transfers — callers simply don't
 * render this component when `kind === 'transfer'`.
 */
export function ForeignFeeFields({
  accountCurrency,
  locale,
  foreignEnabled,
  onToggleForeign,
  foreignCurrency,
  onChangeForeignCurrency,
  rateText,
  onChangeRateText,
  appliedRate,
  fetchingRate,
  rateOptional = false,
  onTurnOnRates,
  turningOnRates = false,
  feeKind,
  onChangeFeeKind,
  feeValue,
  onChangeFeeValue,
  errors,
  preview,
}: {
  accountCurrency: string;
  locale: string;
  foreignEnabled: boolean;
  onToggleForeign: (enabled: boolean) => void;
  foreignCurrency: string;
  onChangeForeignCurrency: (value: string) => void;
  rateText: string;
  onChangeRateText: (value: string) => void;
  appliedRate: AppliedRate | null;
  fetchingRate: boolean;
  /** Recurring schedules: a blank rate resolves per occurrence date rather than snapshotting one now. */
  rateOptional?: boolean;
  /** When provided, a missing rate offers this inline action (opt-in automatic rates). Omit once rates are already on. */
  onTurnOnRates?: () => void;
  turningOnRates?: boolean;
  feeKind: ForeignFeeKind;
  onChangeFeeKind: (kind: ForeignFeeKind) => void;
  feeValue: string;
  onChangeFeeValue: (value: string) => void;
  errors: ForeignFeeFieldsErrors;
  preview: ForeignFeePreview;
}) {
  const { t } = useLocalization();
  const theme = useQashyTheme();
  const [rateOverrideOpen, setRateOverrideOpen] = useState(() => Boolean(rateText.trim()));
  // Errors only surface once a field has been edited or left, so toggling a
  // section on (or picking a fee type) doesn't open with a wall of red.
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [rateTouched, setRateTouched] = useState(false);
  const [feeTouched, setFeeTouched] = useState(false);
  const currencyOptions = useMemo(
    () =>
      [...SUPPORTED_CURRENCY_CODES]
        .filter((code) => code !== accountCurrency.trim().toUpperCase())
        .map((code): ChoiceListOption => ({ value: code, label: currencyLabel(code, locale), description: code }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [accountCurrency, locale],
  );
  const showBreakdown = (foreignEnabled || feeKind !== 'none') &&
    preview.principalMinor !== null && preview.feeMinor !== null && preview.totalMinor !== null;

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="label">Paid in another currency</AppText>
          <AppText variant="caption" muted>Track the original amount and convert it to this account’s currency.</AppText>
        </View>
        <QashySwitch accessibilityLabel={t('Paid in another currency')} value={foreignEnabled} onValueChange={(enabled) => {
          if (!enabled) setCurrencyTouched(false);
          onToggleForeign(enabled);
        }} />
      </View>

      {foreignEnabled ? (
        <View style={{ gap: 12 }}>
          <ChoiceListField
            label="Foreign currency"
            value={foreignCurrency.trim().toUpperCase()}
            options={currencyOptions}
            onChange={(value) => {
              setCurrencyTouched(true);
              onChangeForeignCurrency(value);
            }}
            searchable
            literalOptions
            searchPlaceholder="Search by currency name or code"
          />
          {currencyTouched && errors.foreignCurrency ? (
            <AppText accessibilityRole="alert" variant="caption" style={{ color: theme.negative }}>{errors.foreignCurrency}</AppText>
          ) : null}
          {appliedRate ? (
            <AppText literal variant="caption" muted>
              {`1 ${foreignCurrency.trim().toUpperCase() || '?'} = ${localizeDecimalString(appliedRate.rate, locale)} ${accountCurrency} · ${mediumDate(appliedRate.effectiveDate, locale)} · ${appliedRate.automatic ? t('Automatic') : t('Manual')}`}
            </AppText>
          ) : fetchingRate ? (
            <AppText variant="caption" muted>Fetching rate…</AppText>
          ) : (
            <View style={{ gap: 6 }}>
              <AppText variant="caption" muted>No rate for this date.</AppText>
              {onTurnOnRates ? (
                <TextButton
                  title={turningOnRates ? 'Turning on…' : 'Turn on automatic rates'}
                  disabled={turningOnRates}
                  onPress={onTurnOnRates}
                  style={{ alignSelf: 'flex-start' }}
                />
              ) : null}
            </View>
          )}
          <TextButton
            title={rateOverrideOpen ? 'Hide rate override' : 'Use a different rate'}
            tone="muted"
            onPress={() => setRateOverrideOpen((open) => !open)}
            style={{ alignSelf: 'flex-start' }}
          />
          {rateOverrideOpen ? (
            <FormField
              label={`1 ${foreignCurrency.trim().toUpperCase() || '?'} equals how many ${accountCurrency}?`}
              literalLabel
              value={rateText}
              onChangeText={(value) => {
                setRateTouched(true);
                onChangeRateText(value);
              }}
              onBlur={() => setRateTouched(true)}
              keyboardType="decimal-pad"
              placeholder="Use the applied rate above"
              error={rateTouched ? errors.rate : undefined}
              hint={rateOptional
                ? 'Leave blank to use each occurrence’s rate.'
                : 'Leave blank to use the applied rate above. The applied rate is snapshotted.'}
            />
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        <AppText variant="label">Extra fee</AppText>
        <SegmentedControl
          label="Extra fee"
          value={feeKind}
          options={[
            { value: 'none' as const, label: 'None' },
            { value: 'percent' as const, label: 'Percentage' },
            { value: 'fixed' as const, label: 'Fixed' },
          ]}
          onChange={(next) => {
            setFeeTouched(false);
            onChangeFeeKind(next);
          }}
        />
        {feeKind === 'percent' ? (
          <FormField
            label="Fee (%)"
            value={feeValue}
            onChangeText={(value) => {
              setFeeTouched(true);
              onChangeFeeValue(value);
            }}
            onBlur={() => setFeeTouched(true)}
            keyboardType="decimal-pad"
            placeholder="0"
            error={feeTouched ? errors.fee : undefined}
          />
        ) : feeKind === 'fixed' ? (
          <FormField
            label={`Fee (${accountCurrency})`}
            literalLabel
            value={feeValue}
            onChangeText={(value) => {
              setFeeTouched(true);
              onChangeFeeValue(value);
            }}
            onBlur={() => setFeeTouched(true)}
            keyboardType="decimal-pad"
            placeholder="0.00"
            error={feeTouched ? errors.fee : undefined}
          />
        ) : null}
      </View>

      {showBreakdown ? (
        <AppText literal figure variant="caption" muted>
          {preview.kind === 'expense'
            ? preview.feeMinor
              ? `${formatMoney(preview.principalMinor!, accountCurrency, locale)} + ${formatMoney(preview.feeMinor, accountCurrency, locale)} ${t('fee')} = ${formatMoney(preview.totalMinor!, accountCurrency, locale)} ${t('charged')}`
              : `${formatMoney(preview.totalMinor!, accountCurrency, locale)} ${t('charged')}`
            : preview.feeMinor
              ? `${formatMoney(preview.principalMinor!, accountCurrency, locale)} − ${formatMoney(preview.feeMinor, accountCurrency, locale)} ${t('fee')} = ${formatMoney(preview.totalMinor!, accountCurrency, locale)} ${t('received')}`
              : `${formatMoney(preview.totalMinor!, accountCurrency, locale)} ${t('received')}`}
        </AppText>
      ) : null}
    </View>
  );
}
