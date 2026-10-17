/**
 * Pure foreign-currency and fee rules shared by the transaction and recurring-schedule forms:
 * validation, the repository payload, and the principal/fee/total breakdown shown under the
 * controls. Money parsing and conversion go through `@/utils/money` only.
 */

import { useMemo } from "react";

import type { TransactionFeeInput, TransactionKind } from "@/domain/models";
import {
  validateCurrencyCode,
  validateMoneyInput,
  validatePositiveDecimal,
} from "@/utils/form-validation";
import {
  convertMinor,
  normalizeDecimalString,
  parseMoney,
} from "@/utils/money";
import {
  feeMinorFor,
  normalizeFeePercent,
  totalWithFee,
} from "@/utils/transaction-amounts";

import type { ForeignFeeKind, ForeignFeePreview } from "./foreign-fee-fields";

/** Error for the typed foreign currency; it must be a real code other than the account's. */
function validateForeignCurrency(
  enabled: boolean,
  currencyText: string,
  accountCurrency: string | undefined,
): string | undefined {
  if (!enabled) return undefined;
  return (
    validateCurrencyCode(currencyText) ??
    (accountCurrency && currencyText.trim().toUpperCase() === accountCurrency
      ? "Foreign currency must differ from the account currency."
      : undefined)
  );
}

/** Error for the typed foreign rate; blank is allowed (the repository resolves one). */
function validateForeignRate(
  enabled: boolean,
  rateText: string,
  locale: string,
): string | undefined {
  return enabled
    ? validatePositiveDecimal(rateText, "Exchange rate", true, locale)
    : undefined;
}

/** Error for the typed fee; `accountCurrency` is needed to judge a fixed fee. */
function validateFee(
  feeKind: ForeignFeeKind,
  feeValue: string,
  accountCurrency: string | undefined,
  locale: string,
): string | undefined {
  if (feeKind === "percent") {
    const error = validatePositiveDecimal(feeValue, "Fee", false, locale);
    if (error) return error;
    try {
      normalizeFeePercent(normalizeDecimalString(feeValue, locale));
    } catch {
      return "Fee must be greater than 0% and at most 100%.";
    }
    return undefined;
  }
  if (feeKind === "fixed") {
    return accountCurrency
      ? validateMoneyInput(feeValue, accountCurrency, locale, {
          label: "Fee",
          positive: true,
        })
      : undefined;
  }
  return undefined;
}

/** The fee as the repository takes it; null when none is chosen or the value is blank. Throws on bad input. */
export function feeInputFor(
  feeKind: ForeignFeeKind,
  feeValue: string,
  accountCurrency: string,
  locale: string,
): TransactionFeeInput | null {
  if (!feeValue.trim()) return null;
  if (feeKind === "percent") {
    return {
      kind: "percent",
      percent: normalizeFeePercent(normalizeDecimalString(feeValue, locale)),
    };
  }
  if (feeKind === "fixed") {
    return {
      kind: "fixed",
      amountMinor: parseMoney(feeValue, accountCurrency, locale),
    };
  }
  return null;
}

/**
 * The account-currency principal/fee/total breakdown shown under the foreign/fee controls. Bad or
 * incomplete input (an unresolved currency, an unparsable amount) only blanks the preview, never
 * throws during render.
 */
function foreignFeePreviewFor(input: {
  kind: TransactionKind;
  accountCurrency: string | undefined;
  /** The foreign leg when one is active: its currency, whether that is invalid, and its rate. */
  foreign: {
    currency: string;
    currencyInvalid: boolean;
    rateText: string;
    appliedRate: string | undefined;
  } | null;
  amount: string;
  feeKind: ForeignFeeKind;
  feeValue: string;
  locale: string;
}): ForeignFeePreview {
  const { accountCurrency, foreign, amount, feeKind, feeValue, locale } = input;
  const previewKind: "expense" | "income" =
    input.kind === "income" ? "income" : "expense";
  const empty = {
    principalMinor: null,
    feeMinor: null,
    totalMinor: null,
    kind: previewKind,
  } as const;
  if (input.kind === "transfer" || !accountCurrency) return empty;
  try {
    let principalMinor: number;
    if (foreign) {
      if (foreign.currencyInvalid) return empty;
      const foreignMinor = parseMoney(amount, foreign.currency, locale);
      const rate = foreign.rateText.trim()
        ? normalizeDecimalString(foreign.rateText, locale)
        : foreign.appliedRate;
      if (!rate) return empty;
      principalMinor = convertMinor(
        foreignMinor,
        foreign.currency,
        accountCurrency,
        rate,
        locale,
      );
    } else {
      principalMinor = parseMoney(amount, accountCurrency, locale);
    }
    const fee = feeInputFor(feeKind, feeValue, accountCurrency, locale);
    const feeMinor = fee ? feeMinorFor(principalMinor, fee) : 0;
    return {
      principalMinor,
      feeMinor,
      totalMinor: totalWithFee(previewKind, principalMinor, feeMinor),
      kind: previewKind,
    };
  } catch {
    return empty;
  }
}

/**
 * The foreign currency and rate errors for a form. A hook only so React Compiler treats its
 * primitive arguments as read-only; it keeps no state.
 */
export function useForeignLegErrors(input: {
  enabled: boolean;
  currencyText: string;
  rateText: string;
  accountCurrency: string | undefined;
  locale: string;
}) {
  return {
    currency: validateForeignCurrency(
      input.enabled,
      input.currencyText,
      input.accountCurrency,
    ),
    rate: validateForeignRate(input.enabled, input.rateText, input.locale),
  };
}

/**
 * The fee error and the principal/fee/total breakdown for a form. A transfer carries no fee.
 * `foreignCurrency` is the trimmed, upper-cased code when a foreign leg is active, else null.
 */
export function useFeeBreakdown(input: {
  kind: TransactionKind;
  accountCurrency: string | undefined;
  foreignCurrency: string | null;
  foreignCurrencyInvalid: boolean;
  foreignRateText: string;
  foreignAppliedRate: string | undefined;
  amount: string;
  feeKind: ForeignFeeKind;
  feeValue: string;
  locale: string;
}) {
  const {
    kind,
    accountCurrency,
    foreignCurrency,
    foreignCurrencyInvalid,
    foreignRateText,
    foreignAppliedRate,
    amount,
    feeKind,
    feeValue,
    locale,
  } = input;
  const feeError = validateFee(
    kind === "transfer" ? "none" : feeKind,
    feeValue,
    accountCurrency,
    locale,
  );
  const preview = useMemo(
    () =>
      foreignFeePreviewFor({
        kind,
        accountCurrency,
        foreign:
          foreignCurrency === null
            ? null
            : {
                currency: foreignCurrency,
                currencyInvalid: foreignCurrencyInvalid,
                rateText: foreignRateText,
                appliedRate: foreignAppliedRate,
              },
        amount,
        feeKind,
        feeValue,
        locale,
      }),
    [
      kind,
      accountCurrency,
      foreignCurrency,
      foreignCurrencyInvalid,
      foreignRateText,
      foreignAppliedRate,
      amount,
      feeKind,
      feeValue,
      locale,
    ],
  );
  return { feeError, preview };
}
