import { Decimal } from "decimal.js";

import type { FinanceContext } from "@/data/finance/context";
import {
  hasRate,
  plainDecimal,
  rateOrNullWhileUpcoming,
  resolveRate,
  resolveTransferAwareRate,
} from "@/data/finance/rates";
import { active, applyTransactionChanges } from "@/data/finance/records";
import { assertTransactionSetSafe } from "@/data/finance/safety";
import {
  assertDate,
  assertExpectedRevision,
  assertPositiveMinor,
  findExisting,
  normalizeCurrency,
  normalizeRate,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from "@/data/finance/validation";
import type {
  Account,
  ForeignAmount,
  TransactionFee,
  TransactionRecord,
  TransactionStatus,
} from "@/domain/models";
import type { TransactionInput } from "@/data/repository";
import type { TransferConversion } from "@/utils/account-impact";
import { occurrenceTransactionId } from "@/utils/deterministic-id";
import { createEntity, makeId, updateEntity } from "@/utils/entity";
import { convertMinor, currencyDigits } from "@/utils/money";
import {
  feeMinorFor,
  normalizeFeePercent,
  principalOf,
  totalWithFee,
} from "@/utils/transaction-amounts";

// How far a manually entered transfer destination amount may sit from the
// rate-derived amount before it reads as a typo rather than spread (one order
// of magnitude either way).
const MANUAL_TRANSFER_AMOUNT_TOLERANCE = 10;

/** The signature of `buildTransaction`, for rules that build transactions through the repository. */
export type BuildTransaction = (
  input: TransactionInput,
  id?: string,
  additionalTagIds?: string[],
  expectedRevision?: number,
  newId?: string,
) => TransactionRecord;

/**
 * Validates `input` and turns it into the transaction row it would be saved as: the account,
 * category and tag references checked, foreign pricing and the fee folded in, and the rate
 * snapshots (source leg, and a transfer's destination leg) taken. Reads the snapshot and
 * changes nothing.
 */
export function buildTransaction(
  ctx: FinanceContext,
  input: TransactionInput,
  id?: string,
  additionalTagIds: string[] = [],
  expectedRevision?: number,
  newId?: string,
) {
  assertDate(input.localDate);
  if (!TRANSACTION_TYPES.includes(input.kind))
    throw new Error("Choose a valid transaction type.");
  const status = input.status ?? "posted";
  if (!TRANSACTION_STATUSES.includes(status))
    throw new Error("Choose a valid transaction status.");
  const existing = findExisting(ctx.state.transactions, id, "transaction");
  assertExpectedRevision(existing, input, expectedRevision);
  const { account, destination, category } = resolveLedgerReferences(
    ctx,
    input,
    existing,
  );
  const tagIds = resolveTagIds(ctx, input, existing, additionalTagIds);
  if (input.kind === "transfer" && (input.foreign || input.fee)) {
    throw new Error(
      "Foreign amounts and fees apply to expenses and income only.",
    );
  }
  const { principalMinor, foreign } = priceForeignPrincipal(
    ctx,
    input,
    account,
    existing,
  );
  const fee = buildFee(input, principalMinor);
  const amountMinor =
    input.kind === "transfer"
      ? input.amountMinor
      : fee
        ? totalWithFee(input.kind, principalMinor, fee.amountMinor)
        : principalMinor;
  const { rate, baseAmountMinor } = priceSourceLeg(
    ctx,
    input,
    status,
    account,
    destination,
    existing,
    amountMinor,
  );
  let destinationAmountMinor: number | null = null;
  let destinationBaseAmountMinor: number | null = null;
  if (input.kind === "transfer") {
    ({ destinationAmountMinor, destinationBaseAmountMinor } =
      priceDestinationLeg(
        ctx,
        input,
        status,
        account,
        destination!,
        existing,
        baseAmountMinor,
      ));
  }
  const value = {
    kind: input.kind,
    status,
    title:
      input.title.trim() ||
      (input.kind === "transfer" ? "Transfer" : "Untitled"),
    note: input.note?.trim() ?? "",
    localDate: input.localDate,
    accountId: account.id,
    destinationAccountId: destination?.id ?? null,
    categoryId: input.kind === "transfer" ? null : (category?.id ?? null),
    tagIds,
    amountMinor,
    destinationAmountMinor,
    destinationBaseAmountMinor,
    currency: account.currency,
    destinationCurrency: destination?.currency ?? null,
    exchangeRate: rate === null ? null : normalizeRate(rate),
    baseAmountMinor,
    transferGroupId:
      input.kind === "transfer"
        ? (existing?.transferGroupId ?? makeId())
        : null,
    recurringRuleId: input.recurringRuleId ?? existing?.recurringRuleId ?? null,
    occurrenceKey: input.occurrenceKey ?? existing?.occurrenceKey ?? null,
    foreign,
    fee,
  } satisfies Omit<
    TransactionRecord,
    keyof import("@/domain/models").SyncEntity
  >;
  return existing
    ? updateEntity(existing, value)
    : // A generated occurrence gets an id derived from its occurrence key, so two devices
      // that both foreground and run `generateRecurring` produce the *same* transaction
      // rather than two that a later merge has to notice and deduplicate. Manually entered
      // transactions have no occurrence key and stay random.
      // `newId` lets an import supply the id it derived from the source record, so a re-import
      // lands on the same row. It only applies to a new record; an occurrence id still wins.
      (createEntity({
        id: value.occurrenceKey
          ? occurrenceTransactionId(value.occurrenceKey)
          : (newId ?? makeId()),
        ...value,
      }) as TransactionRecord);
}

type ExistingTransaction = TransactionRecord | undefined;

/** The source account, a transfer's destination and the category `input` points at, each checked. */
function resolveLedgerReferences(
  ctx: FinanceContext,
  input: TransactionInput,
  existing: ExistingTransaction,
) {
  const account = active(ctx.state.accounts).find(
    (item) => item.id === input.accountId,
  );
  if (!account || (account.archived && existing?.accountId !== account.id))
    throw new Error("Choose a valid account.");
  const destination =
    input.kind === "transfer" && input.destinationAccountId
      ? active(ctx.state.accounts).find(
          (item) => item.id === input.destinationAccountId,
        )
      : null;
  if (
    input.kind === "transfer" &&
    (!destination ||
      destination.id === account.id ||
      (destination.archived &&
        existing?.destinationAccountId !== destination.id))
  ) {
    throw new Error("Choose a different destination account.");
  }
  const category = input.categoryId
    ? active(ctx.state.categories).find((item) => item.id === input.categoryId)
    : null;
  if (
    input.kind !== "transfer" &&
    input.categoryId &&
    (!category ||
      category.kind !== input.kind ||
      (category.archived && existing?.categoryId !== category.id))
  ) {
    throw new Error(`Choose a valid ${input.kind} category.`);
  }
  return { account, destination, category };
}

/** The distinct tag ids the transaction carries, each of which must exist. */
function resolveTagIds(
  ctx: FinanceContext,
  input: TransactionInput,
  existing: ExistingTransaction,
  additionalTagIds: string[],
) {
  // Some callers (for example recurring generation) omit tags when editing,
  // so omission means "leave them unchanged". Passing an explicit empty
  // array still clears every tag.
  const tagIds = [...new Set(input.tagIds ?? existing?.tagIds ?? [])];
  const knownTagIds = new Set([
    ...active(ctx.state.tags).map((tag) => tag.id),
    ...additionalTagIds,
  ]);
  if (tagIds.some((tagId) => !knownTagIds.has(tagId))) {
    throw new Error("Choose valid tags.");
  }
  return tagIds;
}

/**
 * The principal of an expense or income, and the foreign amount it was priced from when `input`
 * has one. A transfer's amount is never a principal and is validated by the caller.
 */
function priceForeignPrincipal(
  ctx: FinanceContext,
  input: TransactionInput,
  account: Account,
  existing: ExistingTransaction,
) {
  // Foreign pricing and fees never touch a transfer — the total is exactly
  // `input.amountMinor`, validated positive just like it always was. For an
  // expense or income, `input.amountMinor` is the principal *unless* a
  // foreign amount is given, in which case the principal is derived from
  // converting the foreign amount instead and `input.amountMinor` is ignored.
  let principalMinor: number;
  let foreign: ForeignAmount | null = null;
  if (input.kind !== "transfer" && input.foreign) {
    const foreignCurrency = normalizeCurrency(input.foreign.currency);
    if (foreignCurrency === account.currency) {
      throw new Error(
        "Choose a foreign currency different from the account’s.",
      );
    }
    assertPositiveMinor(input.foreign.amountMinor, "Amount");
    // The foreign rate is a transaction snapshot, exactly like the base-currency
    // rate below: reuse it across an edit that does not touch the account,
    // date, or foreign currency, so a since-deleted rate cannot block renaming
    // a transaction that already carries its own snapshot.
    const preservesForeignRateSnapshot =
      Boolean(existing?.foreign) &&
      existing?.accountId === account.id &&
      existing.localDate === input.localDate &&
      existing.foreign?.currency === foreignCurrency;
    const foreignRate = input.foreign.exchangeRate
      ? normalizeRate(input.foreign.exchangeRate)
      : preservesForeignRateSnapshot
        ? existing!.foreign!.exchangeRate
        : resolveRate(ctx, foreignCurrency, account.currency, input.localDate);
    principalMinor = convertMinor(
      input.foreign.amountMinor,
      foreignCurrency,
      account.currency,
      foreignRate,
      ctx.formatLocale,
    );
    if (principalMinor <= 0) {
      throw new Error(
        `This amount converts to less than the smallest unit of ${account.currency}. Enter a larger amount or check the exchange rate.`,
      );
    }
    foreign = {
      amountMinor: input.foreign.amountMinor,
      currency: foreignCurrency,
      exchangeRate: foreignRate,
    };
  } else {
    assertPositiveMinor(input.amountMinor, "Amount");
    principalMinor = input.amountMinor;
  }
  return { principalMinor, foreign };
}

/** The fee of an expense or income, or `null` when `input` has none. */
function buildFee(input: TransactionInput, principalMinor: number) {
  let fee: TransactionFee | null = null;
  if (input.kind !== "transfer" && input.fee) {
    if (input.fee.kind === "fixed") {
      assertPositiveMinor(input.fee.amountMinor, "Fee");
      fee = {
        kind: "fixed",
        percent: null,
        amountMinor: input.fee.amountMinor,
      };
    } else {
      const percent = normalizeFeePercent(input.fee.percent);
      fee = {
        kind: "percent",
        percent,
        amountMinor: feeMinorFor(principalMinor, {
          kind: "percent",
          percent,
        }),
      };
    }
  }
  return fee;
}

/**
 * The exchange rate and base-currency amount the source leg is snapshotted at; both `null`
 * while the row is an upcoming one with no rate yet.
 */
function priceSourceLeg(
  ctx: FinanceContext,
  input: TransactionInput,
  status: TransactionStatus,
  account: Account,
  destination: Account | null | undefined,
  existing: ExistingTransaction,
  amountMinor: number,
) {
  // The applied rate is a transaction snapshot, exactly like the destination
  // leg below. While the account and date are unchanged, re-resolving it
  // through the live rate table let a since-deleted rate block edits to a
  // record that already carries its own rate — renaming a transaction failed
  // with "Missing exchange rate". Reuse the stored rate unless the caller
  // supplies one or the currency pair or date actually moved.
  // An unpriced row keeps no snapshot to reuse, so an edit re-resolves it.
  const preservesRateSnapshot =
    existing?.accountId === account.id &&
    existing.localDate === input.localDate &&
    existing.currency === account.currency &&
    existing.exchangeRate !== null;
  // A cross-currency transfer into the base currency with a typed destination amount is priced
  // by that amount itself: the base value of the source leg *is* what arrived. Requiring a
  // separate stored rate for it made the "Destination amount" alternative unusable.
  const baseDestinationAmountMinor =
    input.kind === "transfer" &&
    destination?.currency === ctx.state.settings.baseCurrency &&
    account.currency !== ctx.state.settings.baseCurrency &&
    input.destinationAmountMinor !== undefined &&
    input.destinationAmountMinor !== null
      ? input.destinationAmountMinor
      : null;
  // `null` means the rate is not known yet. Only an upcoming transaction may be left unpriced;
  // a posted one still needs its rate, so its MissingExchangeRateError propagates.
  const rate = rateOrNullWhileUpcoming(status, () =>
    account.currency === ctx.state.settings.baseCurrency
      ? "1"
      : input.exchangeRate
        ? normalizeRate(input.exchangeRate)
        : preservesRateSnapshot
          ? existing!.exchangeRate
          : resolveTransferAwareRate(
              ctx,
              account.currency,
              input.localDate,
              amountMinor,
              baseDestinationAmountMinor,
            ),
  );
  const baseAmountMinor =
    rate === null
      ? null
      : baseDestinationAmountMinor !== null &&
          !input.exchangeRate &&
          !preservesRateSnapshot &&
          !hasRate(
            ctx,
            account.currency,
            ctx.state.settings.baseCurrency,
            input.localDate,
          )
        ? baseDestinationAmountMinor
        : convertMinor(
            amountMinor,
            account.currency,
            ctx.state.settings.baseCurrency,
            rate,
            ctx.formatLocale,
          );
  // A positive amount that rounds to nothing in the base currency would be a free transaction
  // that still moves an account balance. An unchanged historical record is left alone.
  if (
    amountMinor > 0 &&
    baseAmountMinor !== null &&
    baseAmountMinor <= 0 &&
    existing?.baseAmountMinor !== baseAmountMinor
  ) {
    throw new Error(
      `This amount converts to less than the smallest unit of ${ctx.state.settings.baseCurrency}. Enter a larger amount or check the exchange rate.`,
    );
  }
  return { rate, baseAmountMinor };
}

/**
 * A transfer's destination amount and its base-currency snapshot (`null` while the leg is
 * upcoming and its rate is not known yet).
 */
function priceDestinationLeg(
  ctx: FinanceContext,
  input: TransactionInput,
  status: TransactionStatus,
  account: Account,
  destination: Account,
  existing: ExistingTransaction,
  baseAmountMinor: number | null,
) {
  let destinationAmountMinor: number;
  let destinationBaseAmountMinor: number | null;
  if (destination.currency === account.currency) {
    destinationAmountMinor = input.amountMinor;
  } else if (
    input.destinationAmountMinor !== undefined &&
    input.destinationAmountMinor !== null
  ) {
    assertPositiveMinor(input.destinationAmountMinor, "Destination amount");
    // Re-saving a historical transfer must never be blocked by a value that
    // is already on the record, so only a new or changed amount is checked.
    const unchangedDestinationAmount =
      existing?.kind === "transfer" &&
      existing.destinationAccountId === destination.id &&
      existing.destinationAmountMinor === input.destinationAmountMinor;
    if (!unchangedDestinationAmount) {
      assertManualTransferAmount(
        ctx,
        input.amountMinor,
        account.currency,
        input.destinationAmountMinor,
        destination.currency,
        input.localDate,
      );
    }
    destinationAmountMinor = input.destinationAmountMinor;
  } else {
    destinationAmountMinor = convertMinor(
      input.amountMinor,
      account.currency,
      destination.currency,
      resolveRate(ctx, account.currency, destination.currency, input.localDate),
      ctx.formatLocale,
    );
  }
  const preservesDestinationSnapshot =
    existing?.kind === "transfer" &&
    existing.destinationAccountId === destination.id &&
    existing.localDate === input.localDate &&
    existing.destinationAmountMinor === destinationAmountMinor &&
    existing.destinationBaseAmountMinor !== null;
  if (
    input.destinationBaseAmountMinor !== undefined &&
    input.destinationBaseAmountMinor !== null &&
    // An unpriced source leg cannot verify a same-currency destination base, so that value is
    // derived when the transaction is paid instead of being trusted from the input.
    !(baseAmountMinor === null && destination.currency === account.currency)
  ) {
    assertPositiveMinor(
      input.destinationBaseAmountMinor,
      "Destination base amount",
    );
    // A cross-currency CSV carries this as a historical snapshot. Re-resolving today's
    // editable destination-to-base rate would reject a valid export after that rate changed
    // or was deleted. Same-currency and destination-base legs remain derivable, so keep
    // their forged-value protection without making historical non-base legs unimportable.
    if (
      destination.currency === ctx.state.settings.baseCurrency ||
      destination.currency === account.currency
    ) {
      const expectedDestinationBaseAmountMinor = expectedDestinationBaseAmount(
        ctx,
        destinationAmountMinor,
        destination.currency,
        account.currency,
        baseAmountMinor,
        input.localDate,
      );
      if (
        expectedDestinationBaseAmountMinor === null ||
        input.destinationBaseAmountMinor !== expectedDestinationBaseAmountMinor
      ) {
        throw new Error(
          "Destination base amount does not match the destination amount and exchange rate.",
        );
      }
    }
    destinationBaseAmountMinor = input.destinationBaseAmountMinor;
  } else if (preservesDestinationSnapshot) {
    // Historical destination-leg value is a transaction snapshot. A title,
    // note, category, or source-side edit must not revalue it through rates
    // that may have changed (or been deleted) since the transfer occurred.
    destinationBaseAmountMinor = existing.destinationBaseAmountMinor;
  } else if (destination.currency === ctx.state.settings.baseCurrency) {
    destinationBaseAmountMinor = destinationAmountMinor;
  } else if (destination.currency === account.currency) {
    destinationBaseAmountMinor = baseAmountMinor;
  } else if (
    account.currency === ctx.state.settings.baseCurrency &&
    input.destinationAmountMinor !== undefined &&
    input.destinationAmountMinor !== null &&
    !hasRate(
      ctx,
      destination.currency,
      ctx.state.settings.baseCurrency,
      input.localDate,
    )
  ) {
    // Base → foreign with a typed destination amount: the base value that left the source
    // is the value that arrived, so no stored destination-to-base rate is needed.
    destinationBaseAmountMinor = baseAmountMinor;
  } else {
    // An upcoming leg whose destination-to-base rate is not known yet stays unpriced.
    const destinationRate = rateOrNullWhileUpcoming(status, () =>
      resolveRate(
        ctx,
        destination.currency,
        ctx.state.settings.baseCurrency,
        input.localDate,
      ),
    );
    destinationBaseAmountMinor =
      destinationRate === null
        ? null
        : convertMinor(
            destinationAmountMinor,
            destination.currency,
            ctx.state.settings.baseCurrency,
            destinationRate,
            ctx.formatLocale,
          );
  }
  return { destinationAmountMinor, destinationBaseAmountMinor };
}

/**
 * The plain transaction a transfer becomes when one of its two accounts is deleted, in place:
 * same id, one coherent update.
 *
 * Transfer X→Y with X deleted becomes income on Y of what arrived (in Y's currency, at the
 * destination leg's base value). Transfer Y→X becomes an expense on Y of what left (the amount
 * already includes any fee, and keeps its own rate snapshot). Every field of the `ledger` sync
 * group is written together, so a peer never sees a half-converted transaction; the other
 * fields written (`categoryId`, `recurringRuleId`) are independent registers with no coupling.
 * The balance of the surviving account does not change: the same amount lands on it as before.
 */
export function convertTransferToPlain(
  ctx: FinanceContext,
  conversion: TransferConversion,
  deletedRuleIds: ReadonlySet<string>,
): TransactionRecord {
  const transaction = conversion.transaction;
  const common = {
    destinationAccountId: null,
    destinationAmountMinor: null,
    destinationBaseAmountMinor: null,
    destinationCurrency: null,
    transferGroupId: null,
    categoryId: null,
    foreign: null,
    fee: null,
    recurringRuleId:
      transaction.recurringRuleId !== null &&
      deletedRuleIds.has(transaction.recurringRuleId)
        ? null
        : transaction.recurringRuleId,
  };
  if (conversion.as === "expense")
    return updateEntity(transaction, { ...common, kind: "expense" });

  const keep = ctx.state.accounts.find(
    (account) => account.id === conversion.keepAccountId,
  );
  if (!keep || transaction.destinationAmountMinor === null)
    throw new Error("This transfer cannot be kept as income.");
  const base = ctx.state.settings.baseCurrency;
  const amountMinor = transaction.destinationAmountMinor;
  const baseAmountMinor = transaction.destinationBaseAmountMinor;
  let exchangeRate: string | null = null;
  if (baseAmountMinor !== null) {
    if (keep.currency === base) exchangeRate = "1";
    else if (keep.currency === transaction.currency && transaction.exchangeRate)
      exchangeRate = transaction.exchangeRate;
    else {
      // The rate the destination leg was valued at, implied by its own two amounts.
      if (amountMinor <= 0 || baseAmountMinor <= 0)
        throw new Error("This transfer cannot be kept as income.");
      const locale = ctx.formatLocale;
      exchangeRate = normalizeRate(
        plainDecimal(
          new Decimal(baseAmountMinor)
            .div(new Decimal(10).pow(currencyDigits(base, locale)))
            .div(
              new Decimal(amountMinor).div(
                new Decimal(10).pow(currencyDigits(keep.currency, locale)),
              ),
            ),
        ),
      );
    }
  }
  return updateEntity(transaction, {
    ...common,
    kind: "income",
    accountId: keep.id,
    amountMinor,
    currency: keep.currency,
    exchangeRate,
    baseAmountMinor,
    // A posted row needs its snapshot; one that never had it can only be upcoming, as the
    // sync repair would also say.
    ...(baseAmountMinor === null && transaction.status === "posted"
      ? { status: "upcoming" as const }
      : {}),
  });
}

// A manual destination amount carries real spread and fees, so it is never
// required to agree with the stored rate. A misplaced decimal point, though,
// lands orders of magnitude away and silently conjures value into (or out of)
// every later base-currency total, with nothing on screen to show for it.
// Reject only that, and only when a rate for the pair is actually known.
export function assertManualTransferAmount(
  ctx: FinanceContext,
  amountMinor: number,
  fromCurrency: string,
  destinationAmountMinor: number,
  toCurrency: string,
  localDate: string,
) {
  let expected: number;
  try {
    expected = convertMinor(
      amountMinor,
      fromCurrency,
      toCurrency,
      resolveRate(ctx, fromCurrency, toCurrency, localDate),
      ctx.formatLocale,
    );
  } catch {
    return;
  }
  if (expected <= 0) return;
  const ratio = destinationAmountMinor / expected;
  if (
    ratio >= 1 / MANUAL_TRANSFER_AMOUNT_TOLERANCE &&
    ratio <= MANUAL_TRANSFER_AMOUNT_TOLERANCE
  )
    return;
  throw new Error(
    `Destination amount is far from the known ${fromCurrency} → ${toCurrency} rate for ${localDate}. Check the amount, or update the rate first.`,
  );
}

/**
 * Reconstructs the base snapshot that a CSV row is allowed to claim.
 *
 * A destination-base snapshot is historical data, but a CSV is editable and the value affects
 * linked goal progress. The source-side snapshot is enough when both legs use the same
 * currency; otherwise the destination leg must be priced by the current effective rate. A
 * missing rate is deliberately unverifiable rather than a reason to trust the supplied number.
 */
export function expectedDestinationBaseAmount(
  ctx: FinanceContext,
  destinationAmountMinor: number,
  destinationCurrency: string,
  sourceCurrency: string,
  sourceBaseAmountMinor: number | null,
  localDate: string,
): number | null {
  if (destinationCurrency === ctx.state.settings.baseCurrency)
    return destinationAmountMinor;
  if (destinationCurrency === sourceCurrency) return sourceBaseAmountMinor;
  try {
    return convertMinor(
      destinationAmountMinor,
      destinationCurrency,
      ctx.state.settings.baseCurrency,
      resolveRate(
        ctx,
        destinationCurrency,
        ctx.state.settings.baseCurrency,
        localDate,
      ),
      ctx.formatLocale,
    );
  } catch {
    return null;
  }
}

export function transactionDuplicateKey(
  ctx: FinanceContext,
  transaction: TransactionRecord,
  suppliedTagNames?: string[],
) {
  const tagNames =
    suppliedTagNames ??
    transaction.tagIds.map(
      (id) => ctx.state.tags.find((tag) => tag.id === id)?.name ?? id,
    );
  return JSON.stringify([
    transaction.localDate,
    transaction.kind,
    transaction.status,
    transaction.accountId,
    transaction.destinationAccountId,
    transaction.amountMinor,
    transaction.destinationAmountMinor,
    transaction.currency,
    transaction.destinationCurrency,
    transaction.categoryId,
    transaction.title.trim().toLocaleLowerCase(),
    transaction.note.trim().toLocaleLowerCase(),
    [
      ...new Set(tagNames.map((name) => name.trim().toLocaleLowerCase())),
    ].sort(),
    transaction.exchangeRate ?? "",
  ]);
}

/**
 * The form input that saves `item` again on `localDate`: everything it carries, with the rate
 * snapshots that belonged to the old day left out so they are resolved again for the new one.
 */
export function redatedTransactionInput(
  item: TransactionRecord,
  localDate: string,
): TransactionInput {
  return {
    kind: item.kind,
    status: item.status,
    title: item.title,
    note: item.note,
    localDate,
    accountId: item.accountId,
    destinationAccountId: item.destinationAccountId,
    categoryId: item.categoryId,
    tagIds: item.tagIds,
    amountMinor:
      item.kind === "transfer" ? item.amountMinor : principalOf(item),
    destinationAmountMinor:
      item.kind === "transfer" && item.destinationCurrency !== item.currency
        ? item.destinationAmountMinor
        : null,
    recurringRuleId: item.recurringRuleId,
    occurrenceKey: item.occurrenceKey,
    foreign: item.foreign
      ? {
          amountMinor: item.foreign.amountMinor,
          currency: item.foreign.currency,
        }
      : null,
    fee: item.fee
      ? item.fee.kind === "percent"
        ? { kind: "percent", percent: item.fee.percent ?? "" }
        : { kind: "fixed", amountMinor: item.fee.amountMinor }
      : null,
  };
}

/** The transactions `ids` becomes once each is filed under `categoryId` (or uncategorized). */
export function planCategoryAssignment(
  ctx: FinanceContext,
  ids: string[],
  categoryId: string | null,
) {
  const selected = new Set(ids);
  const candidates = ctx.state.transactions.filter((item) =>
    selected.has(item.id),
  );
  if (candidates.some((item) => item.kind === "transfer")) {
    throw new Error("Transfers do not have categories.");
  }
  if (categoryId) {
    const category = ctx.state.categories.find(
      (item) => item.id === categoryId && !item.archived,
    );
    if (!category) throw new Error("Choose a valid category.");
    if (candidates.some((item) => item.kind !== category.kind)) {
      throw new Error(
        `The ${category.name} category can only be assigned to ${category.kind} transactions.`,
      );
    }
  }
  const updated = candidates.map((item) => updateEntity(item, { categoryId }));
  const transactions = applyTransactionChanges(ctx.state.transactions, updated);
  assertTransactionSetSafe(ctx, transactions);
  return { updated, transactions };
}
