import { Redirect, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useFormSheet } from '@/components/navigation/use-form-sheet';
import { ActionButton } from '@/components/ui/action-button';
import { AppText } from '@/components/ui/app-text';
import { QashySwitch } from '@/components/ui/qashy-switch';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import type { CategoryKind, RecurrenceUnit, TransactionFeeInput, ForeignAmountInput } from '@/domain/models';
import { takeRecurringDraft } from '@/features/more/recurring-draft';
import { AmountHero } from '@/components/finance/amount-hero';
import { ForeignFeeFields, type ForeignFeeKind } from '@/features/transactions/form/foreign-fee-fields';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useLocalization } from '@/localization/localization';
import { confirmDestructive, errorMessage, showError } from '@/utils/confirm';
import { todayLocal } from '@/utils/date';
import {
  validateCurrencyCode,
  validateDateInput,
  validateMoneyInput,
  validatePositiveDecimal,
  validatePositiveInteger,
} from '@/utils/form-validation';
import { hapticSuccess } from '@/utils/haptics';
import { convertMinor, localizeDecimalString, minorToLocalizedDecimalString, normalizeDecimalString, parseMoney } from '@/utils/money';
import { appliedCrossRateFor } from '@/utils/rates';
import { feeMinorFor, normalizeFeePercent, totalWithFee } from '@/utils/transaction-amounts';

const MAX_REPEAT_INTERVAL = 999;

/** "Every month." / "Every 2 months." — plain English singular/plural; Hermes (Android) has no `Intl.PluralRules`. */
function intervalHint(interval: string, unit: RecurrenceUnit) {
  const count = Number(interval);
  if (!Number.isInteger(count) || count < 1) return `Every ${unit}.`;
  return count === 1 ? `Every ${unit}.` : `Every ${count} ${unit}s.`;
}

export function RecurringFormScreen() {
  const params = useLocalSearchParams<{ id?: string; draftId?: string; returnTo?: string }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { t } = useLocalization();
  const existing = params.id ? state.recurringRules.find((item) => item.id === params.id) : undefined;
  const [draft] = useState(() => existing ? null : takeRecurringDraft(params.draftId));
  const [expectedRevision] = useState(existing?.revision);
  const initialAccount = state.accounts.find((item) => item.id === (existing?.template.accountId ?? draft?.accountId))
    ?? state.accounts.find((item) => !item.archived);
  const [kind, setKind] = useState<CategoryKind>(existing?.template.kind ?? draft?.kind ?? 'expense');
  const [title, setTitle] = useState(existing?.template.title ?? draft?.title ?? '');
  const [note, setNote] = useState(existing?.template.note ?? '');
  const [tagIds, setTagIds] = useState(existing?.template.tagIds ?? []);
  const [amount, setAmount] = useState(() => {
    if (existing) {
      return existing.template.foreign
        ? minorToLocalizedDecimalString(existing.template.foreign.amountMinor, existing.template.foreign.currency, state.settings.locale)
        : minorToLocalizedDecimalString(existing.template.amountMinor, existing.template.currency, state.settings.locale);
    }
    return draft?.amount ?? '';
  });
  const [accountId, setAccountId] = useState(initialAccount?.id ?? '');
  const [categoryId, setCategoryId] = useState(existing?.template.categoryId ?? draft?.categoryId ?? '');
  const [unit, setUnit] = useState<RecurrenceUnit>(existing?.unit ?? 'month');
  const [interval, setInterval] = useState(String(existing?.interval ?? 1));
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayLocal());
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [autoPost, setAutoPost] = useState(existing?.autoPost ?? false);
  const [active, setActive] = useState(existing?.active ?? true);
  const [foreignEnabled, setForeignEnabled] = useState(() => Boolean(existing?.template.foreign ?? draft?.foreignCurrency));
  const [foreignCurrency, setForeignCurrency] = useState(() => existing?.template.foreign?.currency ?? draft?.foreignCurrency ?? '');
  const [foreignRate, setForeignRate] = useState(() => existing?.template.foreign?.exchangeRate
    ? localizeDecimalString(existing.template.foreign.exchangeRate, state.settings.locale)
    : '');
  const [feeKind, setFeeKind] = useState<ForeignFeeKind>(() => existing?.template.fee?.kind ?? draft?.feeKind ?? 'none');
  const [feeValue, setFeeValue] = useState(() => {
    if (existing?.template.fee) {
      return existing.template.fee.kind === 'percent'
        ? localizeDecimalString(existing.template.fee.percent, state.settings.locale)
        : minorToLocalizedDecimalString(existing.template.fee.amountMinor, existing.template.currency, state.settings.locale);
    }
    return draft?.feeValue ?? '';
  });
  const [busy, setBusy] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const account = state.accounts.find((item) => item.id === accountId) ?? initialAccount;
  const accountChoices = state.accounts.filter((item) => !item.archived || item.id === accountId);
  const categories = state.categories.filter((item) =>
    item.kind === kind && (!item.archived || item.id === categoryId),
  );
  const referencesArchivedEntity = Boolean(
    account?.archived || categories.find((item) => item.id === categoryId)?.archived,
  );
  const trimmedForeignCurrency = foreignCurrency.trim().toUpperCase();
  const foreignCurrencyError = foreignEnabled
    ? (validateCurrencyCode(foreignCurrency)
      ?? (account && trimmedForeignCurrency === account.currency ? 'Foreign currency must differ from the account currency.' : undefined))
    : undefined;
  const foreignRateError = foreignEnabled
    ? validatePositiveDecimal(foreignRate, 'Exchange rate', true, state.settings.locale)
    : undefined;
  const foreignAppliedRate = useMemo(
    () => (foreignEnabled && account && !foreignCurrencyError
      ? appliedCrossRateFor(state, trimmedForeignCurrency, account.currency, startDate)
      : null),
    [foreignEnabled, account, foreignCurrencyError, trimmedForeignCurrency, startDate, state],
  );
  let feeError: string | undefined;
  if (feeKind === 'percent') {
    feeError = validatePositiveDecimal(feeValue, 'Fee', false, state.settings.locale);
    if (!feeError) {
      try {
        normalizeFeePercent(normalizeDecimalString(feeValue, state.settings.locale));
      } catch {
        feeError = 'Fee must be greater than 0% and at most 100%.';
      }
    }
  } else if (feeKind === 'fixed') {
    feeError = account
      ? validateMoneyInput(feeValue, account.currency, state.settings.locale, { label: 'Fee', positive: true })
      : undefined;
  }
  const foreignFeePreview = useMemo(() => {
    const previewKind: 'expense' | 'income' = kind === 'income' ? 'income' : 'expense';
    const empty = { principalMinor: null, feeMinor: null, totalMinor: null, kind: previewKind } as const;
    if (!account) return empty;
    try {
      let principalMinor: number;
      if (foreignEnabled) {
        if (foreignCurrencyError) return empty;
        const foreignMinor = parseMoney(amount, trimmedForeignCurrency, state.settings.locale);
        const rate = foreignRate.trim()
          ? normalizeDecimalString(foreignRate, state.settings.locale)
          : foreignAppliedRate?.rate;
        if (!rate) return empty;
        principalMinor = convertMinor(foreignMinor, trimmedForeignCurrency, account.currency, rate, state.settings.locale);
      } else {
        principalMinor = parseMoney(amount, account.currency, state.settings.locale);
      }
      let feeInput: TransactionFeeInput | null = null;
      if (feeKind === 'percent' && feeValue.trim()) {
        feeInput = { kind: 'percent', percent: normalizeFeePercent(normalizeDecimalString(feeValue, state.settings.locale)) };
      } else if (feeKind === 'fixed' && feeValue.trim()) {
        feeInput = { kind: 'fixed', amountMinor: parseMoney(feeValue, account.currency, state.settings.locale) };
      }
      const feeMinor = feeInput ? feeMinorFor(principalMinor, feeInput) : 0;
      const totalMinor = totalWithFee(previewKind, principalMinor, feeMinor);
      return { principalMinor, feeMinor, totalMinor, kind: previewKind };
    } catch {
      return empty;
    }
  }, [kind, account, foreignEnabled, foreignCurrencyError, amount, trimmedForeignCurrency, foreignRate, foreignAppliedRate, feeKind, feeValue, state.settings.locale]);
  const { closeToOwner } = useFormSheet({
    ownerRoute: params.returnTo === '/overview' || params.returnTo === '/transactions' ? params.returnTo : '/more',
    values: {
      kind, title, note, tagIds, amount, accountId, categoryId, unit, interval, startDate, endDate, autoPost, active,
      foreignEnabled, foreignCurrency, foreignRate, feeKind, feeValue,
    },
  });
  const amountError = account
    ? validateMoneyInput(amount, foreignEnabled && !foreignCurrencyError ? trimmedForeignCurrency : account.currency, state.settings.locale, { label: 'Amount', positive: true })
    : 'Choose an account before entering an amount.';
  const intervalError = validatePositiveInteger(interval, 'Repeat interval')
    ?? (Number(interval) > MAX_REPEAT_INTERVAL ? `Repeat interval must be ${MAX_REPEAT_INTERVAL} or less.` : undefined);
  const startDateError = validateDateInput(startDate, { label: 'Start date' });
  const endDateFormatError = validateDateInput(endDate, { label: 'End date', optional: true });
  const endDateError = !endDateFormatError && endDate && startDate && endDate < startDate
    ? 'End date must not precede the start date.'
    : endDateFormatError;
  const canSave = Boolean(account) && !amountError && !intervalError && !startDateError && !endDateError
    && !foreignCurrencyError && !foreignRateError && !feeError;
  const toggleTag = (tagId: string) => {
    setTagIds((current) => current.includes(tagId)
      ? current.filter((item) => item !== tagId)
      : [...current, tagId]);
  };

  const save = async () => {
    if (!account || busy || !canSave) return;
    setBusy(true);
    try {
      const normalizedInterval = Math.max(1, Math.floor(Number(interval) || 1));
      const normalizedEndDate = endDate || null;
      // A recurring template snapshots the original amount and any rate override, but
      // a blank rate stays blank here (unlike the transaction form, which reuses an
      // unchanged snapshot) — each occurrence resolves its own rate as it posts.
      const foreignPayload: ForeignAmountInput | null = foreignEnabled
        ? {
          amountMinor: parseMoney(amount, trimmedForeignCurrency, state.settings.locale),
          currency: trimmedForeignCurrency,
          exchangeRate: foreignRate.trim() ? normalizeDecimalString(foreignRate, state.settings.locale) : undefined,
        }
        : null;
      const feePayload: TransactionFeeInput | null = feeKind === 'percent' && feeValue.trim()
        ? { kind: 'percent', percent: normalizeDecimalString(feeValue, state.settings.locale) }
        : feeKind === 'fixed' && feeValue.trim()
          ? { kind: 'fixed', amountMinor: parseMoney(feeValue, account.currency, state.settings.locale) }
          : null;
      const templateAmountMinor = foreignEnabled
        ? (foreignFeePreview.principalMinor ?? foreignPayload!.amountMinor)
        : parseMoney(amount, account.currency, state.settings.locale);
      await repository.saveRecurringRule({
        template: {
          kind,
          title: title.trim() || t('Recurring transaction'),
          note: note.trim(),
          accountId: account.id,
          categoryId: categoryId || null,
          tagIds,
          amountMinor: templateAmountMinor,
          currency: account.currency,
          foreign: foreignPayload,
          fee: feePayload,
        },
        unit,
        interval: normalizedInterval,
        startDate,
        endDate: normalizedEndDate,
        nextDueDate: existing?.nextDueDate ?? startDate,
        autoPost,
        active,
      }, existing?.id, expectedRevision);
      hapticSuccess();
      closeToOwner();
    } catch (reason) {
      showError('Couldn’t save schedule', errorMessage(reason, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || busy) return;
    if (!(await confirmDestructive({ title: 'Delete this schedule?', message: 'Already generated transactions stay in your ledger.' }))) return;
    setBusy(true);
    try {
      await repository.deleteEntities('recurringRules', [existing.id]);
      closeToOwner();
    } catch (reason) {
      showError('Couldn’t delete schedule', errorMessage(reason, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (params.id && !existing) return <Redirect href="/more" />;

  return (
    <FormScreen contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
      <AmountHero
        currency={foreignEnabled && trimmedForeignCurrency ? trimmedForeignCurrency : account?.currency ?? state.settings.baseCurrency}
        value={amount}
        onChangeText={(next) => {
          setAmountTouched(true);
          setAmount(next);
        }}
        onBlur={() => setAmountTouched(true)}
        error={amountTouched || existing ? amountError : undefined}
      />
      <Card style={{ gap: 16 }}>
        <View accessibilityLabel={t('Recurring transaction kind')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>{(['expense', 'income'] as CategoryKind[]).map((item) => <View key={item} style={{ flex: 1 }}><ChoiceChip icon={item === "income" ? "arrow.down" : item === "expense" ? "arrow.up" : "arrow.left.arrow.right"} label={item[0].toUpperCase() + item.slice(1)} selected={kind === item} onPress={() => {
          if (item === kind) return;
          setKind(item);
          setCategoryId('');
        }} /></View>)}</View>
        <FormField label="Title" value={title} onChangeText={setTitle} placeholder="Rent, salary, subscription…" />
        <AppText variant="label">Account</AppText>
        <View accessibilityLabel={t('Recurring account')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{accountChoices.map((item) => <ChoiceChip key={item.id} literal icon={item.icon} label={`${item.name}${item.archived ? ` (${t('Archived')})` : ''}`} disabled={item.archived} selected={accountId === item.id} onPress={() => {
          if (item.id === accountId) return;
          setAccountId(item.id);
          setForeignRate('');
        }} />)}</View>
        <AppText variant="label">Category</AppText>
        <View accessibilityLabel={t('Recurring category')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <ChoiceChip icon="questionmark.circle" label="Uncategorized" selected={!categoryId} onPress={() => setCategoryId('')} />
          {categories.map((item) => <ChoiceChip key={item.id} literal icon={item.icon} label={`${item.name}${item.archived ? ` (${t('Archived')})` : ''}`} disabled={item.archived} selected={categoryId === item.id} onPress={() => setCategoryId(item.id)} />)}
        </View>
        <FormField label="Note" value={note} onChangeText={setNote} placeholder="Optional context" multiline style={{ minHeight: 92, textAlignVertical: 'top' }} />
        {state.tags.length ? (
          <>
            <AppText variant="label">Tags</AppText>
            <View accessibilityLabel={t('Recurring tags')} role="group" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {state.tags.map((tag) => <ChoiceChip mode="checkbox" key={tag.id} literal label={tag.name} selected={tagIds.includes(tag.id)} onPress={() => toggleTag(tag.id)} />)}
            </View>
          </>
        ) : null}
        {referencesArchivedEntity ? <AppText variant="caption" muted>This schedule stays paused until its archived account and category are restored.</AppText> : null}
      </Card>

      {account ? (
        <Card style={{ gap: 14 }}>
          <ForeignFeeFields
            accountCurrency={account.currency}
            locale={state.settings.locale}
            foreignEnabled={foreignEnabled}
            onToggleForeign={(enabled) => {
              setForeignEnabled(enabled);
              if (!enabled) setForeignRate('');
            }}
            foreignCurrency={foreignCurrency}
            onChangeForeignCurrency={setForeignCurrency}
            rateText={foreignRate}
            onChangeRateText={setForeignRate}
            appliedRate={foreignAppliedRate}
            fetchingRate={false}
            rateOptional
            feeKind={feeKind}
            onChangeFeeKind={setFeeKind}
            feeValue={feeValue}
            onChangeFeeValue={setFeeValue}
            errors={{ foreignCurrency: foreignCurrencyError, rate: foreignRateError, fee: feeError }}
            preview={foreignFeePreview}
          />
        </Card>
      ) : null}

      <Card style={{ gap: 16 }}>
        <AppText variant="label">Repeats</AppText>
        <View accessibilityLabel={t('Recurrence period')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{(['day', 'week', 'month', 'year'] as RecurrenceUnit[]).map((item) => <ChoiceChip key={item} icon="calendar" label={item[0].toUpperCase() + item.slice(1)} selected={unit === item} onPress={() => setUnit(item)} />)}</View>
        <FormField label="Every" value={interval} onChangeText={setInterval} keyboardType="number-pad" error={intervalError} hint={intervalHint(interval, unit)} required />
        <FormField label="Starts" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" error={startDateError} required />
        <FormField label="Ends (optional)" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" error={endDateError} />
        <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <View style={{ flex: 1, gap: 2 }}><AppText variant="label">Post automatically</AppText><AppText variant="caption" muted>Off by default. Upcoming items wait for your review.</AppText></View>
          <QashySwitch accessibilityLabel={t('Post automatically')} value={autoPost} onValueChange={setAutoPost} />
        </View>
        <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <View style={{ flex: 1, gap: 2 }}><AppText variant="label">Schedule active</AppText><AppText variant="caption" muted>Pause without deleting this schedule.</AppText></View>
          <QashySwitch accessibilityLabel={t('Schedule active')} value={active} onValueChange={setActive} disabled={referencesArchivedEntity} />
        </View>
      </Card>

      <ActionButton title={busy ? 'Saving…' : existing ? 'Save schedule' : 'Create schedule'} icon="checkmark" size="large" onPress={save} disabled={busy || !canSave} busy={busy} />
      {existing ? <ActionButton title="Delete schedule" icon="trash" variant="danger" onPress={remove} disabled={busy} /> : null}
    </FormScreen>
  );
}
