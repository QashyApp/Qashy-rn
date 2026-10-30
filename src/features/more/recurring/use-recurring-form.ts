import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { useFormSheet } from "@/components/navigation/use-form-sheet";
import type {
  CategoryKind,
  RecurrenceUnit,
  ForeignAmountInput,
} from "@/domain/models";
import {
  peekRecurringDraft,
  takeRecurringDraft,
} from "@/features/more/recurring-draft";
import {
  useRateLookup,
  useTurnOnAutomaticRates,
} from "@/features/shared/use-automatic-rates";
import type { RatePair } from "@/data/exchange-rates/rate-service";
import {
  feeInputFor,
  useFeeBreakdown,
  useForeignLegErrors,
} from "@/features/transactions/form/fee-model";
import { type ForeignFeeKind } from "@/features/transactions/form/foreign-fee-fields";
import { useExchangeRateStatus } from "@/providers/exchange-rate-provider";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useLocalization } from "@/localization/localization";
import {
  confirmAction,
  confirmDestructive,
  errorMessage,
  showError,
} from "@/utils/confirm";
import { isLocalDate, todayLocal } from "@/utils/date";
import {
  validateDateInput,
  validateMoneyInput,
  validatePositiveInteger,
} from "@/utils/form-validation";
import { hapticSuccess } from "@/services/haptics";
import {
  localizeDecimalString,
  minorToLocalizedDecimalString,
  normalizeDecimalString,
  parseMoney,
} from "@/utils/money";
import { appliedCrossRateFor } from "@/utils/rates";
import {
  overduePostedBySave,
  pendingOccurrences,
} from "@/utils/recurring-impact";
import {
  MAX_OCCURRENCE_COUNT,
  nthOccurrenceDate,
  occurrenceCountUntil,
} from "@/utils/recurrence-count";
import {
  EndMode,
  MAX_REPEAT_INTERVAL,
  mayTurnOnWhenEndExtended,
  projectedNextDueDate,
} from "@/features/more/recurring/recurring-model";
import { canPostNow } from "@/data/finance/rates";

export function useRecurringForm() {
  const params = useLocalSearchParams<{
    id?: string;
    draftId?: string;
    returnTo?: string;
  }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { locale, t } = useLocalization();
  const existing = params.id
    ? state.recurringRules.find((item) => item.id === params.id)
    : undefined;
  // Peeked in the initializer, consumed in the effect below. Consuming during render would delete
  // the draft on StrictMode's second invocation, which would then read nothing.
  const [draft] = useState(() =>
    existing ? null : peekRecurringDraft(params.draftId),
  );
  useEffect(() => {
    // Single use: the values are now in state, so the handoff is spent.
    takeRecurringDraft(params.draftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consumes once, on mount
  }, []);
  const [expectedRevision] = useState(existing?.revision);
  const initialAccount =
    state.accounts.find(
      (item) => item.id === (existing?.template.accountId ?? draft?.accountId),
    ) ?? state.accounts.find((item) => !item.archived);
  const [kind, setKind] = useState<CategoryKind>(
    existing?.template.kind ?? draft?.kind ?? "expense",
  );
  const [title, setTitle] = useState(
    existing?.template.title ?? draft?.title ?? "",
  );
  const [note, setNote] = useState(existing?.template.note ?? "");
  const [tagIds, setTagIds] = useState(existing?.template.tagIds ?? []);
  const [amount, setAmount] = useState(() => {
    if (existing) {
      return existing.template.foreign
        ? minorToLocalizedDecimalString(
            existing.template.foreign.amountMinor,
            existing.template.foreign.currency,
            locale,
          )
        : minorToLocalizedDecimalString(
            existing.template.amountMinor,
            existing.template.currency,
            locale,
          );
    }
    return draft?.amount ?? "";
  });
  const [accountId, setAccountId] = useState(initialAccount?.id ?? "");
  const [categoryId, setCategoryId] = useState(
    existing?.template.categoryId ?? draft?.categoryId ?? "",
  );
  const [unit, setUnit] = useState<RecurrenceUnit>(existing?.unit ?? "month");
  const [interval, setInterval] = useState(String(existing?.interval ?? 1));
  const [startDate, setStartDate] = useState(
    existing?.startDate ?? todayLocal(),
  );
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  // How the schedule ends. "count" is a way to *enter* an end date — "12 payments" for an
  // installment plan — and is stored as the date of the last one, so nothing else changes.
  const [endMode, setEndMode] = useState<EndMode>(
    existing?.endDate ? "date" : "never",
  );
  const [occurrenceCount, setOccurrenceCount] = useState("");
  const [autoPost, setAutoPost] = useState(existing?.autoPost ?? false);
  const [active, setActiveState] = useState(existing?.active ?? true);
  // Whether the user switched the schedule off themselves, now or in an earlier save. Extending an
  // ended schedule's end date turns it back on, but never over a choice the user made.
  const [turnedOffByUser, setTurnedOffByUser] = useState(
    () => !mayTurnOnWhenEndExtended(existing),
  );
  const setActive = (next: boolean) => {
    setTurnedOffByUser(!next);
    setActiveState(next);
  };
  const [foreignEnabled, setForeignEnabled] = useState(() =>
    Boolean(existing?.template.foreign ?? draft?.foreignCurrency),
  );
  const [foreignCurrency, setForeignCurrency] = useState(
    () => existing?.template.foreign?.currency ?? draft?.foreignCurrency ?? "",
  );
  const [foreignRate, setForeignRate] = useState(() =>
    existing?.template.foreign?.exchangeRate
      ? localizeDecimalString(existing.template.foreign.exchangeRate, locale)
      : "",
  );
  const [feeKind, setFeeKind] = useState<ForeignFeeKind>(
    () => existing?.template.fee?.kind ?? draft?.feeKind ?? "none",
  );
  const [feeValue, setFeeValue] = useState(() => {
    if (existing?.template.fee) {
      return existing.template.fee.kind === "percent"
        ? localizeDecimalString(existing.template.fee.percent, locale)
        : minorToLocalizedDecimalString(
            existing.template.fee.amountMinor,
            existing.template.currency,
            locale,
          );
    }
    return draft?.feeValue ?? "";
  });
  const [busy, setBusy] = useState(false);
  const rateStatus = useExchangeRateStatus();
  const [amountTouched, setAmountTouched] = useState(false);
  const account =
    state.accounts.find((item) => item.id === accountId) ?? initialAccount;
  const accountChoices = state.accounts.filter(
    (item) => !item.archived || item.id === accountId,
  );
  const categories = state.categories.filter(
    (item) => item.kind === kind && (!item.archived || item.id === categoryId),
  );
  const accountCurrency = account?.currency;
  const trimmedForeignCurrency = foreignCurrency.trim().toUpperCase();
  const foreignErrors = useForeignLegErrors({
    enabled: foreignEnabled,
    currencyText: foreignCurrency,
    rateText: foreignRate,
    accountCurrency,
    locale: locale,
  });
  const foreignCurrencyError = foreignErrors.currency;
  const foreignRateError = foreignErrors.rate;
  const foreignAppliedRate = useMemo(
    () =>
      foreignEnabled && account && !foreignCurrencyError
        ? appliedCrossRateFor(
            state,
            trimmedForeignCurrency,
            account.currency,
            startDate,
          )
        : null,
    [
      foreignEnabled,
      account,
      foreignCurrencyError,
      trimmedForeignCurrency,
      startDate,
      state,
    ],
  );
  // Debounced and fire-and-forget, like the transaction form: once the account, foreign currency
  // and start date settle, look up the rates they need so the applied rate below fills in on the
  // spot. A failure only ever shows up as "No rate for this date.", never as a save error.
  const ratePairs = useMemo(() => {
    if (!account || !isLocalDate(startDate)) return [];
    const pairs: RatePair[] = [];
    if (account.currency !== state.settings.baseCurrency) {
      pairs.push({ currency: account.currency, localDate: startDate });
    }
    if (
      foreignEnabled &&
      !foreignCurrencyError &&
      trimmedForeignCurrency !== state.settings.baseCurrency
    ) {
      pairs.push({ currency: trimmedForeignCurrency, localDate: startDate });
    }
    return pairs;
  }, [
    account,
    startDate,
    foreignEnabled,
    foreignCurrencyError,
    trimmedForeignCurrency,
    state.settings.baseCurrency,
  ]);
  const fetchingRate = useRateLookup(ratePairs);
  const { turningOn: togglingRates, turnOn: turnOnRates } =
    useTurnOnAutomaticRates();
  const { feeError, preview: foreignFeePreview } = useFeeBreakdown({
    kind,
    accountCurrency,
    foreignCurrency: foreignEnabled ? trimmedForeignCurrency : null,
    foreignCurrencyInvalid: Boolean(foreignCurrencyError),
    foreignRateText: foreignRate,
    foreignAppliedRate: foreignAppliedRate?.rate,
    amount,
    feeKind,
    feeValue,
    locale: locale,
  });
  const { closeToOwner, allowLeave } = useFormSheet({
    ownerRoute:
      params.returnTo === "/overview" || params.returnTo === "/transactions"
        ? params.returnTo
        : "/more",
    values: {
      kind,
      title,
      note,
      tagIds,
      amount,
      accountId,
      categoryId,
      unit,
      interval,
      startDate,
      endDate,
      endMode,
      occurrenceCount,
      autoPost,
      active,
      foreignEnabled,
      foreignCurrency,
      foreignRate,
      feeKind,
      feeValue,
    },
  });
  const amountError = account
    ? validateMoneyInput(
        amount,
        foreignEnabled && !foreignCurrencyError
          ? trimmedForeignCurrency
          : account.currency,
        locale,
        { label: "Amount", positive: true },
      )
    : "Choose an account before entering an amount.";
  const intervalError =
    validatePositiveInteger(interval, "Repeat interval") ??
    (Number(interval) > MAX_REPEAT_INTERVAL
      ? `Repeat interval must be ${MAX_REPEAT_INTERVAL} or less.`
      : undefined);
  const startDateError = validateDateInput(startDate, { label: "Start date" });
  const endDateFormatError = validateDateInput(endDate, {
    label: "End date",
    optional: true,
  });
  const endDateError =
    !endDateFormatError && endDate && startDate && endDate < startDate
      ? "End date must not precede the start date."
      : endDateFormatError;
  const occurrenceCountError =
    // Empty is not an error yet, only unfinished: saving waits for `countedEndDate` regardless.
    endMode !== "count" || !occurrenceCount.trim()
      ? undefined
      : (validatePositiveInteger(occurrenceCount, "Number of times") ??
        (Number(occurrenceCount) > MAX_OCCURRENCE_COUNT
          ? `Number of times must be ${MAX_OCCURRENCE_COUNT} or less.`
          : undefined));
  const scheduleReady = !intervalError && !startDateError;
  // The date a count resolves to, shown under the field and saved as the end date.
  const countedEndDate =
    endMode === "count" &&
    scheduleReady &&
    occurrenceCount.trim() &&
    !occurrenceCountError
      ? nthOccurrenceDate(
          startDate,
          unit,
          Math.floor(Number(interval)),
          Number(occurrenceCount),
        )
      : null;
  const missingEndDate =
    endMode === "date" && !endDate ? "Choose the end date." : undefined;
  const changeEndMode = (next: EndMode) => {
    if (next === endMode) return;
    // Carry the end over between the two ways of entering it, so switching shows the same end.
    if (next === "count" && endDate && scheduleReady) {
      const count = occurrenceCountUntil(
        startDate,
        unit,
        Math.floor(Number(interval)),
        endDate,
      );
      if (count !== null) setOccurrenceCount(String(count));
    }
    if (next === "date" && countedEndDate) setEndDate(countedEndDate);
    setEndMode(next);
  };
  // The end date this form would save, and whether it leaves no occurrence to come. Such a
  // schedule is saved switched off (generation ends it), so the form shows it as ended with the
  // toggle locked rather than letting "active" silently turn itself off on save.
  const resolvedEndDate =
    endMode === "count"
      ? countedEndDate
      : endMode === "date" && isLocalDate(endDate)
        ? endDate
        : null;
  const earliestPendingDate = existing
    ? pendingOccurrences(state.transactions, existing.id)
        .map((item) => item.localDate)
        .sort()[0]
    : undefined;
  // The next payment the schedule would have once saved. Past the end date, there is none left.
  const projectedNext =
    scheduleReady && isLocalDate(startDate)
      ? projectedNextDueDate({
          existing,
          unit,
          interval: Math.floor(Number(interval)),
          startDate,
          endDate: resolvedEndDate,
          earliestPendingDate,
          today: todayLocal(),
        })
      : null;
  const scheduleEnded = Boolean(
    resolvedEndDate && projectedNext && projectedNext > resolvedEndDate,
  );
  // The projected date only explains an ended schedule; it is null otherwise.
  const nextAfterEnd = scheduleEnded ? projectedNext : null;
  // Extending the end date past the next payment lifts the lock, and turns the schedule on with
  // it unless the user had switched it off. Adjusted during render, from the previous value.
  // While the end condition is unfinished (a blank count or date) nothing resolves, so the schedule
  // only looks not ended for lack of an answer: wait rather than treat that as an extension.
  const endIncomplete =
    (endMode === "count" || endMode === "date") && resolvedEndDate === null;
  const [wasEnded, setWasEnded] = useState(scheduleEnded);
  if (!endIncomplete && wasEnded !== scheduleEnded) {
    setWasEnded(scheduleEnded);
    if (wasEnded && !turnedOffByUser) setActiveState(true);
  }
  const effectiveActive = active && !scheduleEnded;
  const canSave =
    Boolean(account) &&
    !amountError &&
    !intervalError &&
    !startDateError &&
    (endMode !== "date" || (!endDateError && !missingEndDate)) &&
    (endMode !== "count" || (!occurrenceCountError && !!countedEndDate)) &&
    !foreignCurrencyError &&
    !foreignRateError &&
    !feeError;
  const toggleTag = (tagId: string) => {
    setTagIds((current) =>
      current.includes(tagId)
        ? current.filter((item) => item !== tagId)
        : [...current, tagId],
    );
  };

  const save = async () => {
    if (!account || busy || !canSave) return;
    // Saving an active rule runs generation at once, and generation posts every due occurrence of
    // an auto-post rule, including ones that were waiting for review. Say so before it happens.
    const today = todayLocal();
    // Only occurrences that can be priced today post; one waiting for a rate stays upcoming.
    const pricingContext = {
      state,
      formatLocale: locale,
      postedTransactions: () => [],
      transactionById: () => new Map(),
    };
    const overdue = overduePostedBySave(
      existing,
      { autoPost, active: effectiveActive },
      state.transactions,
      today,
      (transaction) => canPostNow(pricingContext, transaction, today),
    );
    if (
      overdue > 0 &&
      !(await confirmAction({
        title: "Post overdue payments?",
        message:
          overdue === 1
            ? "1 overdue payment will be posted now."
            : `${overdue} overdue payments will be posted now.`,
        confirmLabel: "Post them",
      }))
    )
      return;
    setBusy(true);
    try {
      const normalizedInterval = Math.max(1, Math.floor(Number(interval) || 1));
      const normalizedEndDate =
        endMode === "count"
          ? countedEndDate
          : endMode === "date"
            ? endDate || null
            : null;
      // A recurring template snapshots the original amount and any rate override, but
      // a blank rate stays blank here (unlike the transaction form, which reuses an
      // unchanged snapshot) — each occurrence resolves its own rate as it posts.
      const foreignPayload: ForeignAmountInput | null = foreignEnabled
        ? {
            amountMinor: parseMoney(amount, trimmedForeignCurrency, locale),
            currency: trimmedForeignCurrency,
            exchangeRate: foreignRate.trim()
              ? normalizeDecimalString(foreignRate, locale)
              : undefined,
          }
        : null;
      const feePayload = feeInputFor(
        feeKind,
        feeValue,
        account.currency,
        locale,
      );
      const templateAmountMinor = foreignEnabled
        ? (foreignFeePreview.principalMinor ?? foreignPayload!.amountMinor)
        : parseMoney(amount, account.currency, locale);
      await repository.saveRecurringRule(
        {
          template: {
            kind,
            title: title.trim() || t("Recurring transaction"),
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
          active: effectiveActive,
        },
        existing?.id,
        expectedRevision,
      );
      hapticSuccess();
      closeToOwner();
    } catch (reason) {
      showError("Couldn’t save schedule", errorMessage(reason, "Try again."));
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
    const pending = pendingOccurrences(state.transactions, existing.id).length;
    if (
      !(await confirmDestructive({
        title: "Delete this schedule?",
        message: [
          "Transactions already posted stay in your ledger.",
          ...(pending === 0
            ? []
            : [
                pending === 1
                  ? "1 upcoming payment that hasn’t been posted yet is removed."
                  : `${pending} upcoming payments that haven’t been posted yet are removed.`,
              ]),
        ],
      }))
    )
      return;
    setBusy(true);
    setDeleting(true);
    try {
      await repository.deleteEntities("recurringRules", [existing.id]);
      // The form is done: leaving after a delete must never ask to discard changes.
      allowLeave();
      closeToOwner();
    } catch (reason) {
      // Only a failed delete frees the form again; after a success it stays locked while the sheet exits.
      setDeleting(false);
      setBusy(false);
      showError("Couldn’t delete schedule", errorMessage(reason, "Try again."));
    }
  };

  return {
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
    scheduleEnded,
    nextAfterEnd,
    effectiveActive,
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
  };
}
