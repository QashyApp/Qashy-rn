import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { useFormSheet } from '@/components/navigation/use-form-sheet';
import { ActionButton } from '@/components/ui/action-button';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import { TextButton } from '@/components/ui/text-button';
import type { TransactionKind } from '@/domain/models';
import { useLocalization } from '@/localization/localization';
import { useExchangeRateService, useExchangeRateStatus } from '@/providers/exchange-rate-provider';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useQashyTheme } from '@/theme/theme';
import { confirmDestructive, errorMessage, showError } from '@/utils/confirm';
import { mediumDate, todayLocal, monthKey } from '@/utils/date';
import { stashRecurringDraft } from '@/features/more/recurring-draft';
import {
  validateDateInput,
  validateMoneyInput,
  validatePositiveDecimal,
} from '@/utils/form-validation';
import { hapticSuccess } from '@/utils/haptics';
import {
  localizeDecimalString,
  minorToLocalizedDecimalString,
  normalizeDecimalString,
  parseMoney,
} from '@/utils/money';
import { appliedRateFor } from '@/utils/rates';

/** How long the source/destination currencies must sit still before `ensureRatesFor` fires. */
const RATE_LOOKUP_DEBOUNCE_MS = 400;

export function TransactionFormScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id?: string; returnTo?: string }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const existing = id ? state.transactions.find((item) => item.id === id) : undefined;
  const [expectedRevision] = useState(existing?.revision);
  const defaultAccount = state.accounts.find((item) => !item.archived);
  const [kind, setKind] = useState<TransactionKind>(existing?.kind ?? 'expense');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [amount, setAmount] = useState(() => existing
    ? minorToLocalizedDecimalString(existing.amountMinor, existing.currency, state.settings.locale)
    : '');
  const [date, setDate] = useState(existing?.localDate ?? todayLocal());
  const [accountId, setAccountId] = useState(existing?.accountId ?? defaultAccount?.id ?? '');
  const [destinationAccountId, setDestinationAccountId] = useState(existing?.destinationAccountId ?? '');
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [tagIds, setTagIds] = useState(existing?.tagIds ?? []);
  const [note, setNote] = useState(existing?.note ?? '');
  const [exchangeRate, setExchangeRate] = useState(() => existing?.exchangeRate
    ? localizeDecimalString(existing.exchangeRate, state.settings.locale)
    : '');
  const existingDestination = state.accounts.find((item) => item.id === existing?.destinationAccountId);
  const [destinationAmount, setDestinationAmount] = useState(() =>
    existing && existing.destinationAmountMinor !== null && existingDestination
      ? minorToLocalizedDecimalString(existing.destinationAmountMinor, existingDestination.currency, state.settings.locale)
      : '',
  );
  const [busy, setBusy] = useState(false);
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  // Collapsed for a brand-new transaction; a saved one always carries a snapshotted rate (every
  // needs-rate transaction stores one, override or resolved), so editing one starts expanded —
  // the user is looking at a real historical value, not an empty control hiding a default.
  const [rateOverrideOpen, setRateOverrideOpen] = useState(() => Boolean(existing?.exchangeRate?.trim()));
  const [fetchingRate, setFetchingRate] = useState(false);
  const [togglingRates, setTogglingRates] = useState(false);
  const account = state.accounts.find((item) => item.id === accountId) ?? defaultAccount;
  const destinationAccount = state.accounts.find((item) => item.id === destinationAccountId);
  const categories = useMemo(() => {
    const expectedKind = kind === 'income' ? 'income' : 'expense';
    const active = state.categories.filter((item) => !item.archived && item.kind === expectedKind);
    const current = state.categories.find((item) => item.id === categoryId);
    return current && current.archived && current.kind === expectedKind ? [current, ...active] : active;
  }, [state.categories, kind, categoryId]);
  const needsRate = account && account.currency !== state.settings.baseCurrency;
  // The rate that would apply to the source leg right now — same direct-or-inverse lookup the
  // repository itself would resolve to at save time, computed here only to preview it.
  const appliedRate = useMemo(
    () => (needsRate && account ? appliedRateFor(state, account.currency, date) : null),
    [needsRate, account, date, state],
  );
  const destinationChoices = useMemo(() => {
    const active = state.accounts.filter((item) => !item.archived && item.id !== accountId);
    const current = state.accounts.find((item) => item.id === destinationAccountId);
    return current && current.archived && current.id !== accountId ? [current, ...active] : active;
  }, [state.accounts, accountId, destinationAccountId]);
  // A saved transaction may reference an account that was archived later;
  // keep it visible (disabled) so the selection isn't silently blank.
  const accountChoices = useMemo(() => {
    const active = state.accounts.filter((item) => !item.archived);
    const current = state.accounts.find((item) => item.id === accountId);
    return current && current.archived ? [current, ...active] : active;
  }, [state.accounts, accountId]);

  const amountError = account
    ? validateMoneyInput(amount, account.currency, state.settings.locale, { label: 'Amount', positive: true })
    : 'Choose an account before entering an amount.';
  const dateError = validateDateInput(date);
  const sameCurrencyTransfer = kind === 'transfer' &&
    !!account &&
    !!destinationAccount &&
    account.currency === destinationAccount.currency;
  const destinationAmountError = kind === 'transfer' && destinationAccount && !sameCurrencyTransfer
    ? validateMoneyInput(destinationAmount, destinationAccount.currency, state.settings.locale, {
      label: 'Destination amount',
      optional: true,
      positive: true,
    })
    : undefined;
  const exchangeRateError = needsRate
    ? validatePositiveDecimal(exchangeRate, 'Exchange rate', true, state.settings.locale)
    : undefined;
  const destinationError = kind === 'transfer' && !destinationAccountId
    ? 'Choose a destination account.'
    : undefined;
  // Debounced: an account or date settling triggers one `ensureRatesFor` for whatever this
  // transaction's legs need, so a user still picking an account doesn't fire a request per
  // keystroke. Entirely fire-and-forget — `save()` never awaits this, and a failure only ever
  // shows up as "No rate for this date" below, never as a save error.
  useEffect(() => {
    if (!account || dateError) return;
    const pairs: { currency: string; localDate: string }[] = [];
    if (account.currency !== state.settings.baseCurrency) {
      pairs.push({ currency: account.currency, localDate: date });
    }
    if (
      kind === 'transfer' &&
      destinationAccount &&
      destinationAccount.currency !== state.settings.baseCurrency &&
      destinationAccount.currency !== account.currency
    ) {
      pairs.push({ currency: destinationAccount.currency, localDate: date });
    }
    if (!pairs.length) return;
    const timer = setTimeout(() => {
      setFetchingRate(true);
      exchangeRateService.ensureRatesFor(pairs)
        .catch(() => undefined)
        .finally(() => setFetchingRate(false));
    }, RATE_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [account, destinationAccount, date, dateError, kind, exchangeRateService, state.settings.baseCurrency]);
  const turnOnRates = async () => {
    if (togglingRates) return;
    setTogglingRates(true);
    try {
      await exchangeRateService.setEnabled(true);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that this may have just supplied one.
      await repository.generateRecurring();
      if (account) {
        await exchangeRateService.ensureRatesFor([{ currency: account.currency, localDate: date }]).catch(() => undefined);
      }
    } catch (reason) {
      showError('Couldn’t turn on automatic rates', errorMessage(reason, 'Try again.'));
    } finally {
      setTogglingRates(false);
    }
  };
  const canSave = Boolean(account)
    && !amountError
    && !dateError
    && !destinationAmountError
    && !exchangeRateError
    && !destinationError;
  const ownerRoute = returnTo === '/overview' ? '/overview' as const : '/transactions' as const;
  const { closeToOwner } = useFormSheet({
    ownerRoute,
    values: { kind, title, amount, date, accountId, destinationAccountId, categoryId, tagIds, note, exchangeRate, destinationAmount },
  });
  const toggleTag = (tagId: string) => {
    setTagIds((current) => current.includes(tagId)
      ? current.filter((item) => item !== tagId)
      : [...current, tagId]);
  };

  const save = async () => {
    if (!account || busy) return;
    setBusy(true);
    try {
      await repository.saveTransaction({
        kind,
        // Trimmed like every sibling form: a whitespace-only title is truthy, so it
        // slipped past the fallback and saved a transaction that rendered blank.
        title: title.trim() || (kind === 'transfer' ? 'Transfer' : categories.find((item) => item.id === categoryId)?.name ?? 'Transaction'),
        note,
        localDate: date,
        accountId: account.id,
        destinationAccountId: kind === 'transfer' ? destinationAccountId : null,
        destinationAmountMinor: kind === 'transfer' &&
          destinationAccount &&
          !sameCurrencyTransfer &&
          destinationAmount.trim()
          ? parseMoney(destinationAmount, destinationAccount.currency, state.settings.locale)
          : null,
        categoryId: kind === 'transfer' ? null : categoryId || null,
        tagIds,
        amountMinor: parseMoney(amount, account.currency, state.settings.locale),
        exchangeRate: needsRate && exchangeRate.trim()
          ? normalizeDecimalString(exchangeRate, state.settings.locale)
          : undefined,
        status: existing?.status ?? 'posted',
      }, existing?.id, expectedRevision);
      hapticSuccess();
      // Land on the month the transaction was filed under, so a back-dated
      // entry is visible the moment the sheet closes instead of "missing".
      closeToOwner(ownerRoute === '/transactions' ? { month: monthKey(date) } : undefined);
    } catch (reason) {
      showError('Couldn’t save transaction', errorMessage(reason, 'Check the form and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || busy) return;
    if (!(await confirmDestructive({ title: 'Delete this transaction?', message: `“${existing.title}” will be removed from your ledger.` }))) return;
    setBusy(true);
    try {
      await repository.deleteEntities('transactions', [existing.id]);
      closeToOwner();
    } catch (reason) {
      showError('Couldn’t delete transaction', errorMessage(reason, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (id && !existing) {
    return <Redirect href={returnTo === '/overview' ? '/overview' : '/transactions'} />;
  }

  return (
    <FormScreen>
      <View accessibilityLabel={t('Transaction kind')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
        {(['expense', 'income', 'transfer'] as TransactionKind[]).map((item) => (
          <View key={item} style={{ flex: 1 }}><ChoiceChip icon={item === "income" ? "arrow.down" : item === "expense" ? "arrow.up" : "arrow.left.arrow.right"} label={item[0].toUpperCase() + item.slice(1)} selected={kind === item} onPress={() => {
            if (item === kind) return;
            setKind(item);
            setCategoryId('');
          }} /></View>
        ))}
      </View>

      <Card style={{ gap: 16 }}>
        <FormField
          label={`Amount (${account?.currency ?? state.settings.baseCurrency})`}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
          autoFocus={!existing}
          error={amountError}
          required
          style={{ fontSize: 30, fontWeight: '700', minHeight: 68, fontVariant: ['tabular-nums'] }}
        />
        <FormField label="Title" value={title} onChangeText={setTitle} placeholder={kind === 'transfer' ? 'Transfer' : 'What was it?'} />
        <FormField label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" error={dateError} required />
      </Card>

      <Card style={{ gap: 14 }}>
        <AppText variant="label">From account</AppText>
        <View accessibilityLabel={t('From account')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {accountChoices.map((item) => <ChoiceChip key={item.id} literal icon={item.icon} label={`${item.name} · ${item.currency}${item.archived ? ' (archived)' : ''}`} disabled={item.archived} selected={accountId === item.id} onPress={() => {
            if (item.id === accountId) return;
            setAccountId(item.id);
            setExchangeRate('');
            setRateOverrideOpen(false);
            setDestinationAmount('');
            if (destinationAccountId === item.id) setDestinationAccountId('');
          }} />)}
        </View>
        {kind === 'transfer' ? (
          <>
            <AppText variant="label">To account</AppText>
            {destinationChoices.length ? (
              <View accessibilityLabel={t('To account')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {destinationChoices.map((item) => <ChoiceChip key={item.id} literal icon={item.icon} label={`${item.name} · ${item.currency}${item.archived ? ' (archived)' : ''}`} disabled={item.archived} selected={destinationAccountId === item.id} onPress={() => {
                  if (item.id === destinationAccountId) return;
                  setDestinationAccountId(item.id);
                  setDestinationAmount('');
                }} />)}
              </View>
            ) : (
              <View role="alert" style={{ gap: 10, padding: 14, borderRadius: 14, backgroundColor: theme.surfaceMuted }}>
                <AppText variant="label">Transfers need two accounts</AppText>
                <AppText variant="caption" muted>Add another account, then return here to finish this transfer. Your draft will stay open.</AppText>
                <ActionButton
                  title="Add another account"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/account', params: { returnTo: '/transaction' } })}
                />
              </View>
            )}
            {destinationError && destinationChoices.length ? <AppText accessibilityRole="alert" variant="caption" style={{ color: theme.negative }}>{destinationError}</AppText> : null}
            {destinationAccount && !sameCurrencyTransfer ? (
              <FormField
                label={`Destination amount (${destinationAccount.currency})`}
                value={destinationAmount}
                onChangeText={setDestinationAmount}
                keyboardType="decimal-pad"
                placeholder="Calculated automatically"
                error={destinationAmountError}
                hint="Leave blank to calculate through your automatic or manual exchange rates."
              />
            ) : sameCurrencyTransfer ? (
              <AppText variant="caption" muted>The destination receives the same amount; same-currency transfers always conserve value.</AppText>
            ) : null}
          </>
        ) : (
          <>
            <AppText variant="label">Category</AppText>
            <View accessibilityLabel={t('Category')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <ChoiceChip icon="questionmark.circle" label="Uncategorized" selected={!categoryId} onPress={() => setCategoryId('')} />
              {categories.map((item) => <ChoiceChip key={item.id} literal icon={item.icon} label={`${item.name}${item.archived ? ' (archived)' : ''}`} disabled={item.archived} selected={categoryId === item.id} onPress={() => setCategoryId(item.id)} />)}
            </View>
          </>
        )}
      </Card>

      {state.tags.length && kind !== 'transfer' ? (
        <Card style={{ gap: 14 }}>
          <AppText variant="label">Tags</AppText>
          <View accessibilityLabel={t('Transaction tags')} role="group" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {state.tags.map((tag) => <ChoiceChip mode="checkbox" key={tag.id} literal label={tag.name} selected={tagIds.includes(tag.id)} onPress={() => toggleTag(tag.id)} />)}
          </View>
        </Card>
      ) : null}

      {needsRate && account ? (
        <Card style={{ gap: 12 }}>
          {appliedRate ? (
            <AppText literal variant="caption" muted>
              {`1 ${account.currency} = ${localizeDecimalString(appliedRate.rate, state.settings.locale)} ${state.settings.baseCurrency} · ${mediumDate(appliedRate.effectiveDate, state.settings.locale)} · ${appliedRate.automatic ? t('Automatic') : t('Manual')}`}
            </AppText>
          ) : fetchingRate ? (
            <AppText variant="caption" muted>Fetching rate…</AppText>
          ) : (
            <View style={{ gap: 6 }}>
              <AppText variant="caption" muted>No rate for this date.</AppText>
              {!rateStatus.enabled ? (
                <TextButton
                  title={togglingRates ? 'Turning on…' : 'Turn on automatic rates'}
                  disabled={togglingRates}
                  onPress={turnOnRates}
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
              label={`1 ${account.currency} equals how many ${state.settings.baseCurrency}?`}
              value={exchangeRate}
              onChangeText={setExchangeRate}
              keyboardType="decimal-pad"
              placeholder="Use the applied rate above"
              error={exchangeRateError}
              hint="Leave blank to use the applied rate above. The applied rate is snapshotted."
            />
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: 14 }}>
        <FormField label="Note" value={note} onChangeText={setNote} placeholder="Optional context" multiline style={{ minHeight: 92, textAlignVertical: 'top' }} />
        {!existing && kind !== 'transfer' ? (
          <TextButton
            title="Make this recurring instead"
            onPress={() => router.push({
              pathname: '/recurring',
              params: { draftId: stashRecurringDraft({ kind, title, amount, accountId, categoryId }) },
            })}
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
      </Card>

      <ActionButton title={busy ? 'Saving…' : existing ? 'Save changes' : 'Add transaction'} icon="checkmark" onPress={save} disabled={busy || !canSave} busy={busy} />
      {existing ? <ActionButton title="Delete transaction" variant="danger" onPress={remove} disabled={busy} /> : null}
    </FormScreen>
  );
}
