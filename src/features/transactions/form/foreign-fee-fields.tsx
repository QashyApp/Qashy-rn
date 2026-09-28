import { useState } from 'react';
import { Switch, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { FormField } from '@/components/ui/form-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextButton } from '@/components/ui/text-button';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { mediumDate } from '@/utils/date';
import { formatMoney, localizeDecimalString } from '@/utils/money';
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
  feeKind: ForeignFeeKind;
  onChangeFeeKind: (kind: ForeignFeeKind) => void;
  feeValue: string;
  onChangeFeeValue: (value: string) => void;
  errors: ForeignFeeFieldsErrors;
  preview: ForeignFeePreview;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const [rateOverrideOpen, setRateOverrideOpen] = useState(() => Boolean(rateText.trim()));
  const showBreakdown = (foreignEnabled || feeKind !== 'none') &&
    preview.principalMinor !== null && preview.feeMinor !== null && preview.totalMinor !== null;

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="label">Paid in another currency</AppText>
          <AppText variant="caption" muted>Track the original amount and convert it to this account’s currency.</AppText>
        </View>
        <Switch accessibilityLabel={t('Paid in another currency')} value={foreignEnabled} onValueChange={onToggleForeign} trackColor={{ true: theme.accent }} />
      </View>

      {foreignEnabled ? (
        <View style={{ gap: 12 }}>
          <FormField
            label="Foreign currency"
            value={foreignCurrency}
            onChangeText={onChangeForeignCurrency}
            maxLength={3}
            autoCapitalize="characters"
            error={errors.foreignCurrency}
            required
          />
          {appliedRate ? (
            <AppText literal variant="caption" muted>
              {`1 ${foreignCurrency.trim().toUpperCase() || '?'} = ${localizeDecimalString(appliedRate.rate, locale)} ${accountCurrency} · ${mediumDate(appliedRate.effectiveDate, locale)} · ${appliedRate.automatic ? t('Automatic') : t('Manual')}`}
            </AppText>
          ) : fetchingRate ? (
            <AppText variant="caption" muted>Fetching rate…</AppText>
          ) : (
            <AppText variant="caption" muted>No rate for this date.</AppText>
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
              onChangeText={onChangeRateText}
              keyboardType="decimal-pad"
              placeholder="Use the applied rate above"
              error={errors.rate}
              hint={rateOptional
                ? 'Leave blank to use each occurrence’s rate.'
                : 'Leave blank to use the applied rate above. The applied rate is snapshotted.'}
            />
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        <SegmentedControl
          label="Extra fee"
          value={feeKind}
          options={[
            { value: 'none' as const, label: 'None' },
            { value: 'percent' as const, label: 'Percentage' },
            { value: 'fixed' as const, label: 'Fixed' },
          ]}
          onChange={onChangeFeeKind}
        />
        {feeKind === 'percent' ? (
          <FormField
            label="Fee (%)"
            value={feeValue}
            onChangeText={onChangeFeeValue}
            keyboardType="decimal-pad"
            placeholder="0"
            error={errors.fee}
          />
        ) : feeKind === 'fixed' ? (
          <FormField
            label={`Fee (${accountCurrency})`}
            literalLabel
            value={feeValue}
            onChangeText={onChangeFeeValue}
            keyboardType="decimal-pad"
            placeholder="0.00"
            error={errors.fee}
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
