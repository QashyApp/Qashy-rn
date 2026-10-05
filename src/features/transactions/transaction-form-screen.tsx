import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useFormSheet } from "@/components/navigation/use-form-sheet";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { MoneyField } from "@/components/finance/money-field";
import { DateField } from "@/components/ui/date-field";
import { FormField } from "@/components/ui/form-field";
import { FormScreen } from "@/components/ui/form-screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextButton } from "@/components/ui/text-button";
import type {
  TransactionFeeInput,
  TransactionKind,
  ForeignAmountInput,
} from "@/domain/models";
import { AmountHero } from "@/components/finance/amount-hero";
import {
  buildTitleCategoryIndex,
  suggestCategoryForTitle,
} from "@/features/transactions/form/title-category";
import { announceSavedTransaction } from "@/features/transactions/list/saved-transaction-signal";
import {
  evaluateAmountExpression,
  isAmountOperator,
} from "@/utils/amount-expression";
import { CategoryPicker } from "@/features/transactions/form/category-picker";
import {
  ForeignFeeFields,
  type ForeignFeeKind,
} from "@/features/transactions/form/foreign-fee-fields";
import { MoreDetails } from "@/features/transactions/form/more-details";
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
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { mediumDate, todayLocal, monthKey } from "@/utils/date";
import { stashRecurringDraft } from "@/features/more/recurring-draft";
import {
  validateCurrencyCode,
  validateDateInput,
  validateMoneyInput,
  validatePositiveDecimal,
} from "@/utils/form-validation";
import { hapticSuccess } from "@/utils/haptics";
import {
  convertMinor,
  localizeDecimalString,
  minorToLocalizedDecimalString,
  normalizeDecimalString,
  parseMoney,
} from "@/utils/money";
import { appliedCrossRateFor, appliedRateFor } from "@/utils/rates";
import {
  feeMinorFor,
  normalizeFeePercent,
  principalOf,
  totalWithFee,
} from "@/utils/transaction-amounts";

const KIND_OPTIONS = [
  { value: "expense" as const, label: "Expense", icon: "arrow.up" },
  { value: "income" as const, label: "Income", icon: "arrow.down" },
  {
    value: "transfer" as const,
    label: "Transfer",
    icon: "arrow.left.arrow.right",
  },
];

/** How long the source/destination currencies must sit still before `ensureRatesFor` fires. */
const RATE_LOOKUP_DEBOUNCE_MS = 400;

export function TransactionFormScreen() {
  const { id, returnTo } = useLocalSearchParams<{
    id?: string;
    returnTo?: string;
  }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
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
        state.settings.locale,
      );
    }
    return minorToLocalizedDecimalString(
      principalOf(existing),
      existing.currency,
      state.settings.locale,
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
      ? localizeDecimalString(existing.exchangeRate, state.settings.locale)
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
          state.settings.locale,
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
      ? localizeDecimalString(
          existing.foreign.exchangeRate,
          state.settings.locale,
        )
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
          ? localizeDecimalString(existing.exchangeRate, state.settings.locale)
          : "",
      );
      if (!unchanged) setRateOverrideOpen(false);
      else setRateOverrideOpen(Boolean(existing.exchangeRate?.trim()));
    }
    if (!foreignRateEdited) {
      setForeignRate(
        unchanged && existing.foreign?.exchangeRate
          ? localizeDecimalString(
              existing.foreign.exchangeRate,
              state.settings.locale,
            )
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
        ? localizeDecimalString(existing.fee.percent, state.settings.locale)
        : "";
    }
    return minorToLocalizedDecimalString(
      existing.fee.amountMinor,
      existing.currency,
      state.settings.locale,
    );
  });
  const [busy, setBusy] = useState(false);
  const exchangeRateService = useExchangeRateService();
  const rateStatus = useExchangeRateStatus();
  // Collapsed for a brand-new transaction; a saved one always carries a snapshotted rate (every
  // needs-rate transaction stores one, override or resolved), so editing one starts expanded —
  // the user is looking at a real historical value, not an empty control hiding a default.
  const [rateOverrideOpen, setRateOverrideOpen] = useState(() =>
    Boolean(existing?.exchangeRate?.trim()),
  );
  const [fetchingRate, setFetchingRate] = useState(false);
  const [togglingRates, setTogglingRates] = useState(false);
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
  const foreignCurrencyError = foreignActive
    ? (validateCurrencyCode(foreignCurrency) ??
      (account && trimmedForeignCurrency === account.currency
        ? "Foreign currency must differ from the account currency."
        : undefined))
    : undefined;
  const foreignRateError = foreignActive
    ? validatePositiveDecimal(
        foreignRate,
        "Exchange rate",
        true,
        state.settings.locale,
      )
    : undefined;
  // The currency the typed amount is in: the foreign leg when one is active, else the account's.
  // Arithmetic rounds to this currency's minor unit, once, at the end.
  const amountCurrency =
    foreignActive && !foreignCurrencyError
      ? trimmedForeignCurrency
      : (account?.currency ?? state.settings.baseCurrency);
  const amountExpression = useMemo(
    () =>
      evaluateAmountExpression(
        amountInput,
        amountCurrency,
        state.settings.locale,
      ),
    [amountInput, amountCurrency, state.settings.locale],
  );
  const amount =
    amountExpression.kind === "value" ? amountExpression.text : amountInput;
  // A trailing operator is a calculation in progress, not an invalid amount.
  const amountPending =
    amountExpression.kind === "invalid" &&
    isAmountOperator(Array.from(amountInput.trim()).at(-1) ?? "");
  const resolveAmount = (expression: string) => {
    const result = evaluateAmountExpression(
      expression,
      amountCurrency,
      state.settings.locale,
    );
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
  let feeError: string | undefined;
  if (kind !== "transfer" && feeKind === "percent") {
    feeError = validatePositiveDecimal(
      feeValue,
      "Fee",
      false,
      state.settings.locale,
    );
    if (!feeError) {
      try {
        normalizeFeePercent(
          normalizeDecimalString(feeValue, state.settings.locale),
        );
      } catch {
        feeError = "Fee must be greater than 0% and at most 100%.";
      }
    }
  } else if (kind !== "transfer" && feeKind === "fixed") {
    feeError = account
      ? validateMoneyInput(feeValue, account.currency, state.settings.locale, {
          label: "Fee",
          positive: true,
        })
      : undefined;
  }
  // The account-currency principal/fee/total breakdown shown under the foreign/fee
  // controls. Bad or incomplete input (a currency that isn't resolved yet, an
  // unparsable amount) must only blank the preview, never throw during render —
  // the same fail-soft contract `appliedRateFor` gives the rate caption above.
  const foreignFeePreview = useMemo(() => {
    const previewKind: "expense" | "income" =
      kind === "income" ? "income" : "expense";
    const empty = {
      principalMinor: null,
      feeMinor: null,
      totalMinor: null,
      kind: previewKind,
    } as const;
    if (kind === "transfer" || !account) return empty;
    try {
      let principalMinor: number;
      if (foreignActive) {
        if (foreignCurrencyError) return empty;
        const foreignMinor = parseMoney(
          amount,
          trimmedForeignCurrency,
          state.settings.locale,
        );
        const rate = foreignRate.trim()
          ? normalizeDecimalString(foreignRate, state.settings.locale)
          : foreignAppliedRate?.rate;
        if (!rate) return empty;
        principalMinor = convertMinor(
          foreignMinor,
          trimmedForeignCurrency,
          account.currency,
          rate,
          state.settings.locale,
        );
      } else {
        principalMinor = parseMoney(
          amount,
          account.currency,
          state.settings.locale,
        );
      }
      let feeInput: TransactionFeeInput | null = null;
      if (feeKind === "percent" && feeValue.trim()) {
        feeInput = {
          kind: "percent",
          percent: normalizeFeePercent(
            normalizeDecimalString(feeValue, state.settings.locale),
          ),
        };
      } else if (feeKind === "fixed" && feeValue.trim()) {
        feeInput = {
          kind: "fixed",
          amountMinor: parseMoney(
            feeValue,
            account.currency,
            state.settings.locale,
          ),
        };
      }
      const feeMinor = feeInput ? feeMinorFor(principalMinor, feeInput) : 0;
      const totalMinor = totalWithFee(previewKind, principalMinor, feeMinor);
      return { principalMinor, feeMinor, totalMinor, kind: previewKind };
    } catch {
      return empty;
    }
  }, [
    kind,
    account,
    foreignActive,
    foreignCurrencyError,
    amount,
    trimmedForeignCurrency,
    foreignRate,
    foreignAppliedRate,
    feeKind,
    feeValue,
    state.settings.locale,
  ]);
  const amountError = account
    ? validateMoneyInput(
        amount,
        foreignActive && !foreignCurrencyError
          ? trimmedForeignCurrency
          : account.currency,
        state.settings.locale,
        { label: "Amount", positive: true },
      )
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
          state.settings.locale,
          {
            label: "Destination amount",
            optional: true,
            positive: true,
          },
        )
      : undefined;
  const exchangeRateError = needsRate
    ? validatePositiveDecimal(
        exchangeRate,
        "Exchange rate",
        true,
        state.settings.locale,
      )
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
  useEffect(() => {
    if (!account || dateError) return;
    const pairs: { currency: string; localDate: string }[] = [];
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
    if (!pairs.length) return;
    const timer = setTimeout(() => {
      setFetchingRate(true);
      exchangeRateService
        .ensureRatesFor(pairs)
        .catch(() => undefined)
        .finally(() => setFetchingRate(false));
    }, RATE_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    account,
    destinationAccount,
    date,
    dateError,
    kind,
    exchangeRateService,
    state.settings.baseCurrency,
    foreignActive,
    foreignCurrencyError,
    trimmedForeignCurrency,
  ]);
  const turnOnRates = async () => {
    if (togglingRates) return;
    setTogglingRates(true);
    try {
      await exchangeRateService.setEnabled(true);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that this may have just supplied one.
      await repository.generateRecurring();
      if (account) {
        await exchangeRateService
          .ensureRatesFor([{ currency: account.currency, localDate: date }])
          .catch(() => undefined);
      }
    } catch (reason) {
      showError(
        "Couldn’t turn on automatic rates",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setTogglingRates(false);
    }
  };
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
  const accountRateMissing =
    Boolean(needsRate) &&
    !appliedRate &&
    !exchangeRate.trim() &&
    !pricedByDestinationAmount;
  // The other transfer leg needs a rate too when no typed amount supplies it. Without this the
  // gap only surfaced at save time as a reversed-direction "Missing exchange rate" alert.
  const transferLegMissingPair = (() => {
    if (!crossCurrencyTransfer || !account || !destinationAccount) return null;
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
    if (!account || busy || !canSave) return;
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
            amountMinor: parseMoney(
              amount,
              trimmedForeignCurrency,
              state.settings.locale,
            ),
            currency: trimmedForeignCurrency,
            exchangeRate: foreignRate.trim()
              ? normalizeDecimalString(foreignRate, state.settings.locale)
              : existing?.foreign &&
                  existing.foreign.currency === trimmedForeignCurrency &&
                  existing.accountId === account.id &&
                  existing.localDate === date
                ? existing.foreign.exchangeRate
                : undefined,
          }
        : null;
      const feePayload: TransactionFeeInput | null =
        kind === "transfer"
          ? null
          : feeKind === "percent" && feeValue.trim()
            ? {
                kind: "percent",
                percent: normalizeDecimalString(
                  feeValue,
                  state.settings.locale,
                ),
              }
            : feeKind === "fixed" && feeValue.trim()
              ? {
                  kind: "fixed",
                  amountMinor: parseMoney(
                    feeValue,
                    account.currency,
                    state.settings.locale,
                  ),
                }
              : null;
      // The principal in account currency, before fees — `amountMinor` on the
      // input is ignored by the repository once `foreign` is set, but a positive
      // value must still be passed: the converted preview when the rate is
      // known, else the raw foreign amount for the repository to convert itself.
      const principalMinor =
        kind === "transfer"
          ? parseMoney(amount, account.currency, state.settings.locale)
          : foreignActive
            ? (foreignFeePreview.principalMinor ?? foreignPayload!.amountMinor)
            : parseMoney(amount, account.currency, state.settings.locale);
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
                  state.settings.locale,
                )
              : null,
          categoryId: kind === "transfer" ? null : categoryId || null,
          tagIds,
          amountMinor: principalMinor,
          foreign: kind === "transfer" ? null : foreignPayload,
          fee: feePayload,
          exchangeRate:
            needsRate && exchangeRate.trim()
              ? normalizeDecimalString(exchangeRate, state.settings.locale)
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
      setSaveError(errorMessage(reason, "Check the form and try again."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || busy) return;
    if (
      !(await confirmDestructive({
        title: "Delete this transaction?",
        message: `“${existing.title}” will be removed from your ledger.`,
      }))
    )
      return;
    setBusy(true);
    try {
      await repository.deleteEntities("transactions", [existing.id]);
      closeToOwner();
    } catch (reason) {
      showError(
        "Couldn’t delete transaction",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  if (id && !existing) {
    return (
      <Redirect
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
        <Card style={{ gap: 14 }}>
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
      ) : null}

      <Card style={{ gap: 14 }}>
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
              label={`${item.name} · ${item.currency}${item.archived ? " (archived)" : ""}`}
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
                    label={`${item.name} · ${item.currency}${item.archived ? " (archived)" : ""}`}
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
                  gap: 10,
                  padding: 14,
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
        <Card style={{ gap: 14 }}>
          <ForeignFeeFields
            accountCurrency={account.currency}
            locale={state.settings.locale}
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

      <Card style={{ gap: 14 }}>
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
            <View style={{ gap: 14 }}>
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
                  {`1 ${account.currency} = ${localizeDecimalString(appliedRate.rate, state.settings.locale)} ${state.settings.baseCurrency} · ${mediumDate(appliedRate.effectiveDate, state.settings.locale)} · ${appliedRate.automatic ? t("Automatic") : t("Manual")}`}
                </AppText>
              ) : fetchingRate ? (
                <AppText variant="caption" muted>
                  Fetching rate…
                </AppText>
              ) : (
                <View style={{ gap: 6 }}>
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
          style={{ color: theme.negative }}
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
