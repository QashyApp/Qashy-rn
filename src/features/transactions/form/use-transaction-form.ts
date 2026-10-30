import { useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";

import { useFormSheet } from "@/components/navigation/use-form-sheet";
import type { TransactionKind, ForeignAmountInput } from "@/domain/models";
import {
  buildTitleCategoryIndex,
  suggestCategoryForTitle,
} from "@/features/transactions/form/title-category";
import { announceSavedTransaction } from "@/features/transactions/list/saved-transaction-signal";
import {
  evaluateAmountExpression,
  isAmountOperator,
} from "@/utils/amount-expression";
import { type ForeignFeeKind } from "@/features/transactions/form/foreign-fee-fields";
import {
  useRateLookup,
  useTurnOnAutomaticRates,
} from "@/features/shared/use-automatic-rates";
import {
  feeInputFor,
  useFeeBreakdown,
  useForeignLegErrors,
} from "@/features/transactions/form/fee-model";
import type { RatePair } from "@/data/exchange-rates/rate-service";
import { useLocalization } from "@/localization/localization";
import {
  useExchangeRateService,
  useExchangeRateStatus,
} from "@/providers/exchange-rate-provider";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { todayLocal, monthKey } from "@/utils/date";
import {
  validateDateInput,
  validateMoneyInput,
  validatePositiveDecimal,
} from "@/utils/form-validation";
import { hapticError, hapticSuccess } from "@/services/haptics";
import {
  localizeDecimalString,
  minorToLocalizedDecimalString,
  normalizeDecimalString,
  parseMoney,
} from "@/utils/money";
import { appliedCrossRateFor, appliedRateFor } from "@/utils/rates";
import { principalOf } from "@/utils/transaction-amounts";

export function useTransactionForm() {
  const { id, returnTo } = useLocalSearchParams<{
    id?: string;
    returnTo?: string;
  }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { locale, t } = useLocalization();
  const existing = id
    ? state.transactions.find((item) => item.id === id)
    : undefined;
  const [expectedRevision] = useState(existing?.revision);
  const defaultAccount = state.accounts.find((item) => !item.archived);
  const [kind, setKind] = useState<TransactionKind>(
    existing?.kind ?? "expense",
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [amountTouched, setAmountTouched] = useState(false);
  // What the amount field holds: a plain number, or arithmetic typed on the keypad ("12.5 + 3 × 2").
  // `amount` below is what the rest of the form reads, with any arithmetic already evaluated.
  const [amountInput, setAmountInput] = useState(() => {
    if (!existing) return "";
    if (existing.foreign) {
      return minorToLocalizedDecimalString(
        existing.foreign.amountMinor,
        existing.foreign.currency,
        locale,
      );
    }
    return minorToLocalizedDecimalString(
      principalOf(existing),
      existing.currency,
      locale,
    );
  });
  const [date, setDate] = useState(existing?.localDate ?? todayLocal());
  const [accountId, setAccountId] = useState(
    existing?.accountId ?? defaultAccount?.id ?? "",
  );
  const [destinationAccountId, setDestinationAccountId] = useState(
    existing?.destinationAccountId ?? "",
  );
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  // Until the user picks (or clears) a category themselves, it follows the title: a title they have
  // used before fills in the category it was filed under. An existing transaction already has its own.
  const [categoryTouched, setCategoryTouched] = useState(Boolean(existing));
  const titleCategories = useMemo(
    () => (existing ? null : buildTitleCategoryIndex(state.transactions)),
    [existing, state.transactions],
  );
  const suggestedCategoryFor = (
    nextTitle: string,
    nextKind: TransactionKind,
  ) =>
    titleCategories && nextKind !== "transfer"
      ? (suggestCategoryForTitle(
          titleCategories,
          nextTitle,
          nextKind,
          state.categories,
        ) ?? "")
      : "";
  const [tagIds, setTagIds] = useState(existing?.tagIds ?? []);
  const [note, setNote] = useState(existing?.note ?? "");
  const [exchangeRate, setExchangeRate] = useState(() =>
    existing?.exchangeRate
      ? localizeDecimalString(existing.exchangeRate, locale)
      : "",
  );
  const existingDestination = state.accounts.find(
    (item) => item.id === existing?.destinationAccountId,
  );
  const [destinationAmount, setDestinationAmount] = useState(() =>
    existing && existing.destinationAmountMinor !== null && existingDestination
      ? minorToLocalizedDecimalString(
          existing.destinationAmountMinor,
          existingDestination.currency,
          locale,
        )
      : "",
  );
  const [foreignEnabled, setForeignEnabled] = useState(() =>
    Boolean(existing?.foreign),
  );
  const [foreignCurrency, setForeignCurrency] = useState(
    () => existing?.foreign?.currency ?? "",
  );
  const [foreignRate, setForeignRate] = useState(() =>
    existing?.foreign?.exchangeRate
      ? localizeDecimalString(existing.foreign.exchangeRate, locale)
      : "",
  );
  // The rate fields are pre-filled with the saved snapshot when editing. Only a rate the user
  // typed is an override; an untouched one must not pin the old date's rate to a moved date.
  const [exchangeRateEdited, setExchangeRateEdited] = useState(false);
  const [foreignRateEdited, setForeignRateEdited] = useState(false);
  const typeExchangeRate = (value: string) => {
    setExchangeRate(value);
    setExchangeRateEdited(true);
  };
  const typeForeignRate = (value: string) => {
    setForeignRate(value);
    setForeignRateEdited(true);
  };
  const changeDate = (value: string) => {
    setDate(value);
    if (!existing) return;
    const unchanged = value === existing.localDate;
    if (!exchangeRateEdited) {
      setExchangeRate(
        unchanged && existing.exchangeRate
          ? localizeDecimalString(existing.exchangeRate, locale)
          : "",
      );
      if (!unchanged) setRateOverrideOpen(false);
      else setRateOverrideOpen(Boolean(existing.exchangeRate?.trim()));
    }
    if (!foreignRateEdited) {
      setForeignRate(
        unchanged && existing.foreign?.exchangeRate
          ? localizeDecimalString(existing.foreign.exchangeRate, locale)
          : "",
      );
    }
  };
  const [feeKind, setFeeKind] = useState<ForeignFeeKind>(
    () => existing?.fee?.kind ?? "none",
  );
  const [feeValue, setFeeValue] = useState(() => {
    if (!existing?.fee) return "";
    if (existing.fee.kind === "percent") {
      return existing.fee.percent
        ? localizeDecimalString(existing.fee.percent, locale)
        : "";
    }
    return minorToLocalizedDecimalString(
      existing.fee.amountMinor,
      existing.currency,
      locale,
    );
  });
  const [busy, setBusy] = useState(false);
  // `busy` is state, so a second tap landing before the re-render still sees it false. This ref
  // flips synchronously and closes that gap for save and delete alike.
  const inFlight = useRef(false);
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  // Collapsed for a brand-new transaction; a saved one always carries a snapshotted rate (every
  // needs-rate transaction stores one, override or resolved), so editing one starts expanded —
  // the user is looking at a real historical value, not an empty control hiding a default.
  const [rateOverrideOpen, setRateOverrideOpen] = useState(() =>
    Boolean(existing?.exchangeRate?.trim()),
  );
  const [saveError, setSaveError] = useState<string | undefined>();
  const account =
    state.accounts.find((item) => item.id === accountId) ?? defaultAccount;
  const destinationAccount = state.accounts.find(
    (item) => item.id === destinationAccountId,
  );
  const categories = useMemo(() => {
    const expectedKind = kind === "income" ? "income" : "expense";
    const active = state.categories.filter(
      (item) => !item.archived && item.kind === expectedKind,
    );
    const current = state.categories.find((item) => item.id === categoryId);
    return current && current.archived && current.kind === expectedKind
      ? [current, ...active]
      : active;
  }, [state.categories, kind, categoryId]);
  const needsRate = account && account.currency !== state.settings.baseCurrency;
  // The rate that would apply to the source leg right now — same direct-or-inverse lookup the
  // repository itself would resolve to at save time, computed here only to preview it.
  const appliedRate = useMemo(
    () =>
      needsRate && account
        ? appliedRateFor(state, account.currency, date)
        : null,
    [needsRate, account, date, state],
  );
  const destinationChoices = useMemo(() => {
    const active = state.accounts.filter(
      (item) => !item.archived && item.id !== accountId,
    );
    const current = state.accounts.find(
      (item) => item.id === destinationAccountId,
    );
    return current && current.archived && current.id !== accountId
      ? [current, ...active]
      : active;
  }, [state.accounts, accountId, destinationAccountId]);
  // A saved transaction may reference an account that was archived later;
  // keep it visible (disabled) so the selection isn't silently blank.
  const accountChoices = useMemo(() => {
    const active = state.accounts.filter((item) => !item.archived);
    const current = state.accounts.find((item) => item.id === accountId);
    return current && current.archived ? [current, ...active] : active;
  }, [state.accounts, accountId]);

  const foreignActive = kind !== "transfer" && foreignEnabled;
  const trimmedForeignCurrency = foreignCurrency.trim().toUpperCase();
  const foreignErrors = useForeignLegErrors({
    enabled: foreignActive,
    currencyText: foreignCurrency,
    rateText: foreignRate,
    accountCurrency: account?.currency,
    locale: locale,
  });
  const foreignCurrencyError = foreignErrors.currency;
  const foreignRateError = foreignErrors.rate;
  // The currency the typed amount is in: the foreign leg when one is active, else the account's.
  // Arithmetic rounds to this currency's minor unit, once, at the end.
  const amountCurrency =
    foreignActive && !foreignCurrencyError
      ? trimmedForeignCurrency
      : (account?.currency ?? state.settings.baseCurrency);
  const amountExpression = useMemo(
    () => evaluateAmountExpression(amountInput, amountCurrency, locale),
    [amountInput, amountCurrency, locale],
  );
  const amount =
    amountExpression.kind === "value" ? amountExpression.text : amountInput;
  // A trailing operator is a calculation in progress, not an invalid amount.
  const amountPending =
    amountExpression.kind === "invalid" &&
    isAmountOperator(Array.from(amountInput.trim()).at(-1) ?? "");
  const resolveAmount = (expression: string) => {
    const result = evaluateAmountExpression(expression, amountCurrency, locale);
    return result.kind === "value" ? result.text : null;
  };
  const foreignAppliedRate = useMemo(
    () =>
      foreignActive && account && !foreignCurrencyError
        ? appliedCrossRateFor(
            state,
            trimmedForeignCurrency,
            account.currency,
            date,
          )
        : null,
    [
      foreignActive,
      account,
      foreignCurrencyError,
      trimmedForeignCurrency,
      date,
      state,
    ],
  );
  const { feeError, preview: foreignFeePreview } = useFeeBreakdown({
    kind,
    accountCurrency: account?.currency,
    foreignCurrency: foreignActive ? trimmedForeignCurrency : null,
    foreignCurrencyInvalid: Boolean(foreignCurrencyError),
    foreignRateText: foreignRate,
    foreignAppliedRate: foreignAppliedRate?.rate,
    amount,
    feeKind,
    feeValue,
    locale: locale,
  });
  const amountError = account
    ? validateMoneyInput(amount, amountCurrency, locale, {
        label: "Amount",
        positive: true,
      })
    : "Choose an account before entering an amount.";
  const dateError = validateDateInput(date);
  const sameCurrencyTransfer =
    kind === "transfer" &&
    !!account &&
    !!destinationAccount &&
    account.currency === destinationAccount.currency;
  const destinationAmountError =
    kind === "transfer" && destinationAccount && !sameCurrencyTransfer
      ? validateMoneyInput(
          destinationAmount,
          destinationAccount.currency,
          locale,
          {
            label: "Destination amount",
            optional: true,
            positive: true,
          },
        )
      : undefined;
  const exchangeRateError = needsRate
    ? validatePositiveDecimal(exchangeRate, "Exchange rate", true, locale)
    : undefined;
  const destinationError =
    kind === "transfer" && !destinationAccountId
      ? "Choose a destination account."
      : undefined;
  // "More details" folds date/tags/rate/note behind one row on the fast path.
  // Editing an existing transaction always starts expanded — every field in it may
  // already carry a real, non-default value. A brand-new transaction starts collapsed,
  // but attention-worthy state (tags picked, a note typed, or a source currency that
  // needs any rate handling — resolved, missing, or still fetching) always keeps it
  // open regardless of the manual toggle. A foreign-currency account is always worth
  // surfacing the applied/missing rate for, not only while it's unresolved — collapsing
  // must never hide something the user already did or a rate they still need to see.
  const detailsNeedAttention =
    tagIds.length > 0 || note.trim().length > 0 || Boolean(needsRate);
  // The auto-open condition only seeds the initial state and re-expands when a rate becomes
  // relevant (needsRate flips on); after that the user's toggle always wins.
  const [moreOpen, setMoreOpen] = useState(
    () => Boolean(existing) || detailsNeedAttention,
  );
  const [seenNeedsRate, setSeenNeedsRate] = useState(Boolean(needsRate));
  if (Boolean(needsRate) !== seenNeedsRate) {
    setSeenNeedsRate(Boolean(needsRate));
    if (needsRate) setMoreOpen(true);
  }
  // Debounced: an account or date settling triggers one `ensureRatesFor` for whatever this
  // transaction's legs need, so a user still picking an account doesn't fire a request per
  // keystroke. Entirely fire-and-forget — `save()` never awaits this, and a failure only ever
  // shows up as "No rate for this date" below, never as a save error.
  const ratePairs = useMemo(() => {
    if (!account || dateError) return [];
    const pairs: RatePair[] = [];
    if (account.currency !== state.settings.baseCurrency) {
      pairs.push({ currency: account.currency, localDate: date });
    }
    if (
      kind === "transfer" &&
      destinationAccount &&
      destinationAccount.currency !== state.settings.baseCurrency &&
      destinationAccount.currency !== account.currency
    ) {
      pairs.push({ currency: destinationAccount.currency, localDate: date });
    }
    if (
      foreignActive &&
      !foreignCurrencyError &&
      trimmedForeignCurrency !== state.settings.baseCurrency
    ) {
      pairs.push({ currency: trimmedForeignCurrency, localDate: date });
    }
    return pairs;
  }, [
    account,
    destinationAccount,
    date,
    dateError,
    kind,
    state.settings.baseCurrency,
    foreignActive,
    foreignCurrencyError,
    trimmedForeignCurrency,
  ]);
  const fetchingRate = useRateLookup(ratePairs);
  const { turningOn: togglingRates, turnOn: turnOnRates } =
    useTurnOnAutomaticRates(async () => {
      if (account) {
        await exchangeRateService
          .ensureRatesFor([{ currency: account.currency, localDate: date }])
          .catch(() => undefined);
      }
    });
  // A rate the repository would need but can't resolve fails late ("Missing exchange rate"), so it
  // blocks saving up front. A typed override, or an unchanged saved foreign leg, counts as resolved.
  const foreignRateMissing =
    foreignActive &&
    !foreignCurrencyError &&
    !foreignRate.trim() &&
    !foreignAppliedRate &&
    !(
      existing?.foreign &&
      existing.foreign.currency === trimmedForeignCurrency &&
      existing.accountId === account?.id &&
      existing.localDate === date
    );
  // A typed destination amount prices a transfer that touches the base currency by itself (the
  // repository derives the missing leg from it), so no stored rate is needed in that case.
  const baseCurrency = state.settings.baseCurrency;
  const crossCurrencyTransfer =
    kind === "transfer" &&
    !!account &&
    !!destinationAccount &&
    !sameCurrencyTransfer;
  const manualDestination =
    crossCurrencyTransfer &&
    destinationAmount.trim().length > 0 &&
    !destinationAmountError;
  const pricedByDestinationAmount =
    manualDestination &&
    (account?.currency === baseCurrency ||
      destinationAccount?.currency === baseCurrency);
  // An upcoming transaction is priced when it is paid, so editing one may save without a rate. A
  // foreign amount still needs its rate, because that rate sets the principal.
  const rateDeferred = existing?.status === "upcoming";
  const accountRateMissing =
    Boolean(needsRate) &&
    !appliedRate &&
    !exchangeRate.trim() &&
    !pricedByDestinationAmount &&
    !rateDeferred;
  // The other transfer leg needs a rate too when no typed amount supplies it. Without this the
  // gap only surfaced at save time as a reversed-direction "Missing exchange rate" alert.
  const transferLegMissingPair = (() => {
    if (!crossCurrencyTransfer || !account || !destinationAccount) return null;
    if (rateDeferred) return null;
    // Re-saving an unchanged historical transfer keeps its own snapshots.
    if (
      existing?.kind === "transfer" &&
      existing.accountId === account.id &&
      existing.destinationAccountId === destinationAccount.id &&
      existing.localDate === date
    )
      return null;
    if (!manualDestination) {
      return appliedCrossRateFor(
        state,
        account.currency,
        destinationAccount.currency,
        date,
      )
        ? null
        : `${account.currency} → ${destinationAccount.currency}`;
    }
    if (
      account.currency === baseCurrency ||
      destinationAccount.currency === baseCurrency
    )
      return null;
    return appliedRateFor(state, destinationAccount.currency, date)
      ? null
      : `${destinationAccount.currency} → ${baseCurrency}`;
  })();
  const missingRatePair =
    foreignRateMissing && account
      ? `${trimmedForeignCurrency} → ${account.currency}`
      : accountRateMissing && account
        ? `${account.currency} → ${baseCurrency}`
        : transferLegMissingPair;
  const rateMissingMessage =
    missingRatePair && !fetchingRate
      ? `Add an exchange rate for ${missingRatePair} to save${crossCurrencyTransfer && (account?.currency === baseCurrency || destinationAccount?.currency === baseCurrency) ? ", or enter the destination amount" : ""}.`
      : undefined;
  const canSave =
    Boolean(account) &&
    !missingRatePair &&
    !amountError &&
    !dateError &&
    !destinationAmountError &&
    !exchangeRateError &&
    !destinationError &&
    !foreignCurrencyError &&
    !foreignRateError &&
    !feeError;
  const ownerRoute =
    returnTo === "/overview"
      ? ("/overview" as const)
      : ("/transactions" as const);
  const { closeToOwner, allowLeave } = useFormSheet({
    ownerRoute,
    values: {
      kind,
      title,
      amount: amountInput,
      date,
      accountId,
      destinationAccountId,
      categoryId,
      tagIds,
      note,
      exchangeRate,
      destinationAmount,
      foreignEnabled,
      foreignCurrency,
      foreignRate,
      feeKind,
      feeValue,
    },
  });
  const toggleTag = (tagId: string) => {
    setTagIds((current) =>
      current.includes(tagId)
        ? current.filter((item) => item !== tagId)
        : [...current, tagId],
    );
  };

  const save = async () => {
    if (!account || busy || inFlight.current || !canSave) return;
    inFlight.current = true;
    setBusy(true);
    setSaveError(undefined);
    try {
      // `foreign`: the original amount in another currency plus the rate applied
      // to convert it into the account currency. A typed override always wins;
      // otherwise an unchanged currency/account/date keeps the previously
      // snapshotted rate rather than silently re-resolving it, and only a real
      // change (or a brand-new foreign leg) leaves it `undefined` for the
      // repository to resolve fresh.
      const foreignPayload: ForeignAmountInput | null = foreignActive
        ? {
            amountMinor: parseMoney(amount, trimmedForeignCurrency, locale),
            currency: trimmedForeignCurrency,
            exchangeRate: foreignRate.trim()
              ? normalizeDecimalString(foreignRate, locale)
              : existing?.foreign &&
                  existing.foreign.currency === trimmedForeignCurrency &&
                  existing.accountId === account.id &&
                  existing.localDate === date
                ? existing.foreign.exchangeRate
                : undefined,
          }
        : null;
      const feePayload =
        kind === "transfer"
          ? null
          : feeInputFor(feeKind, feeValue, account.currency, locale);
      // The principal in account currency, before fees — `amountMinor` on the
      // input is ignored by the repository once `foreign` is set, but a positive
      // value must still be passed: the converted preview when the rate is
      // known, else the raw foreign amount for the repository to convert itself.
      const principalMinor =
        kind === "transfer"
          ? parseMoney(amount, account.currency, locale)
          : foreignActive
            ? (foreignFeePreview.principalMinor ?? foreignPayload!.amountMinor)
            : parseMoney(amount, account.currency, locale);
      const saved = await repository.saveTransaction(
        {
          kind,
          // Trimmed like every sibling form: a whitespace-only title is truthy, so it
          // slipped past the fallback and saved a transaction that rendered blank.
          title:
            title.trim() ||
            (kind === "transfer"
              ? t("Transfer")
              : (categories.find((item) => item.id === categoryId)?.name ??
                t("Transaction"))),
          note,
          localDate: date,
          accountId: account.id,
          destinationAccountId:
            kind === "transfer" ? destinationAccountId : null,
          destinationAmountMinor:
            kind === "transfer" &&
            destinationAccount &&
            !sameCurrencyTransfer &&
            destinationAmount.trim()
              ? parseMoney(
                  destinationAmount,
                  destinationAccount.currency,
                  locale,
                )
              : null,
          categoryId: kind === "transfer" ? null : categoryId || null,
          // Tags are only editable on expenses and income, so a transfer must not carry the ones
          // picked before the kind was switched (it keeps what an existing transfer already had).
          tagIds:
            kind !== "transfer"
              ? tagIds
              : existing?.kind === "transfer"
                ? existing.tagIds
                : [],
          amountMinor: principalMinor,
          foreign: kind === "transfer" ? null : foreignPayload,
          fee: feePayload,
          exchangeRate:
            needsRate && exchangeRate.trim()
              ? normalizeDecimalString(exchangeRate, locale)
              : undefined,
          status: existing?.status ?? "posted",
        },
        existing?.id,
        expectedRevision,
      );
      hapticSuccess();
      // The ledger scrolls to this row and flashes it once the sheet closes. Only when the ledger
      // owns the sheet: an edit started from Overview has no row to point at.
      if (ownerRoute === "/transactions") {
        announceSavedTransaction({
          id: saved.id,
          localDate: date,
          isNew: !existing,
          previousDate: existing?.localDate,
          today: todayLocal(),
        });
      }
      // Land on the month the transaction was filed under, so a back-dated
      // entry is visible the moment the sheet closes instead of "missing".
      closeToOwner(
        ownerRoute === "/transactions" ? { month: monthKey(date) } : undefined,
      );
    } catch (reason) {
      hapticError();
      setSaveError(errorMessage(reason, "Check the form and try again."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // True while this screen is deleting its own transaction. The delete drops `existing` from the
  // snapshot before `closeToOwner` runs, and without this the "gone" branch below would dismiss
  // the sheet on the spot: no exit animation, and the discard prompt on a dirty form.
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!existing || busy || inFlight.current) return;
    inFlight.current = true;
    if (
      !(await confirmDestructive({
        title: "Delete this transaction?",
        message: `“${existing.title}” will be removed from your ledger.`,
      }))
    ) {
      inFlight.current = false;
      return;
    }
    setBusy(true);
    setDeleting(true);
    try {
      await repository.deleteEntities("transactions", [existing.id]);
      // The form is done: leaving after a delete must never ask to discard changes.
      allowLeave();
      closeToOwner();
    } catch (reason) {
      // Only a failed delete frees the form again; after a success it stays locked while the sheet exits.
      setDeleting(false);
      inFlight.current = false;
      setBusy(false);
      showError(
        "Couldn’t delete transaction",
        errorMessage(reason, "Try again."),
      );
    }
  };

  return {
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
  };
}
