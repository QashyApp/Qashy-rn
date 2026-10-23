import type { FinanceContext } from "@/data/finance/context";
import { withEntity } from "@/data/finance/records";
import { assertGoalProgressSafe } from "@/data/finance/analytics";
import { assertReciprocalRate } from "@/data/finance/rates";
import { assertTransactionSetSafe } from "@/data/finance/safety";
import {
  ACCOUNT_TYPES,
  assertColor,
  assertDate,
  assertExpectedRevision,
  assertNotArchiving,
  assertPositiveMinor,
  assertSafeMinor,
  assertUniqueName,
  CATEGORY_KINDS,
  findExisting,
  normalizeCurrency,
  normalizeRate,
  validateGoal,
} from "@/data/finance/validation";
import type {
  Account,
  Category,
  ExchangeRate,
  Goal,
  GoalContribution,
} from "@/domain/models";
import type {
  AccountInput,
  CategoryInput,
  ContributionInput,
  GoalContributionInput,
  GoalInput,
  RateInput,
} from "@/data/repository";
import { fetchedRateId } from "@/utils/deterministic-id";
import { createEntity, makeId, updateEntity } from "@/utils/entity";
import { isValidIconId } from "@/utils/icon-id";

// Each `plan…Save` validates a save and builds the row it would write, reading the snapshot and
// changing nothing; the repository persists the result. They end where the repository's `await`
// begins, so a failure leaves nothing to undo.

/** The account `input` saves, and the account list as it will read once it is in. */
export function planAccountSave(
  ctx: FinanceContext,
  input: AccountInput,
  id?: string,
  expectedRevision?: number,
) {
  const currency = normalizeCurrency(input.currency);
  assertSafeMinor(input.openingBalanceMinor, "Opening balance");
  assertColor(input.color);
  if (!ACCOUNT_TYPES.includes(input.type))
    throw new Error("Choose a valid account type.");
  const name = input.name.trim() || "Account";
  assertUniqueName(ctx, "accounts", name, id);
  const existing = findExisting(ctx.state.accounts, id, "account");
  assertNotArchiving(input.archived, existing?.archived);
  assertExpectedRevision(existing, input, expectedRevision);
  if (existing && existing.currency !== currency) {
    const hasTransactions = ctx.state.transactions.some(
      (item) =>
        item.accountId === existing.id ||
        item.destinationAccountId === existing.id,
    );
    const hasRules = ctx.state.recurringRules.some(
      (item) => item.template.accountId === existing.id,
    );
    if (hasTransactions || hasRules) {
      throw new Error(
        "Account currency cannot change after transactions or schedules reference it.",
      );
    }
  }
  const account = existing
    ? updateEntity(existing, {
        ...input,
        name,
        currency,
        color: input.color.toUpperCase(),
      })
    : (createEntity({
        id: makeId(),
        ...input,
        name,
        currency,
        color: input.color.toUpperCase(),
      }) as Account);
  const accounts = withEntity(ctx.state.accounts, account);
  assertTransactionSetSafe(ctx, ctx.state.transactions, accounts);
  return { account, existing, accounts };
}

/** The category `input` saves, and the category list as it will read once it is in. */
export function planCategorySave(
  ctx: FinanceContext,
  input: CategoryInput,
  id?: string,
  expectedRevision?: number,
) {
  const name = input.name.trim() || "Category";
  assertUniqueName(ctx, "categories", name, id);
  assertColor(input.color);
  if (!isValidIconId(input.icon)) throw new Error("Choose a valid icon.");
  if (!CATEGORY_KINDS.includes(input.kind))
    throw new Error("Choose a valid category kind.");
  const existing = findExisting(ctx.state.categories, id, "category");
  assertNotArchiving(input.archived, existing?.archived);
  assertExpectedRevision(existing, input, expectedRevision);
  if (existing && existing.kind !== input.kind) {
    const isReferenced =
      ctx.state.transactions.some((item) => item.categoryId === existing.id) ||
      ctx.state.recurringRules.some(
        (item) => item.template.categoryId === existing.id,
      ) ||
      ctx.state.budgets.some((item) =>
        item.filters.categoryIds.includes(existing.id),
      ) ||
      ctx.state.goals.some((item) => item.linkedCategoryId === existing.id) ||
      ctx.state.categories.some((item) => item.parentId === existing.id);
    if (isReferenced)
      throw new Error(
        "Category kind cannot change after finance records reference it.",
      );
  }
  if (input.parentId) {
    const parent = ctx.state.categories.find(
      (item) => item.id === input.parentId,
    );
    const preservesArchivedParent =
      !!existing && existing.parentId === parent?.id;
    if (
      !parent ||
      (!preservesArchivedParent && parent.archived) ||
      parent.kind !== input.kind ||
      parent.parentId ||
      parent.id === id
    ) {
      throw new Error(
        "Choose a valid top-level parent category of the same kind.",
      );
    }
    if (
      existing &&
      ctx.state.categories.some((item) => item.parentId === existing.id)
    ) {
      throw new Error(
        "A category with child categories cannot also have a parent.",
      );
    }
  }
  const values = {
    ...input,
    name,
    color: input.color.toUpperCase(),
  };
  const category = existing
    ? updateEntity(existing, values)
    : (createEntity({ id: makeId(), ...values }) as Category);
  const categories = withEntity(ctx.state.categories, category);
  return { category, existing, categories };
}

/** The goal `input` saves and, when `contribution` is given, the contribution saved with it. */
export function planGoalSave(
  ctx: FinanceContext,
  input: GoalInput,
  contribution?: GoalContributionInput,
  id?: string,
  expectedRevision?: number,
) {
  const normalized = validateGoal(ctx, input, id);
  const existing = findExisting(ctx.state.goals, id, "goal");
  assertNotArchiving(input.archived, existing?.archived);
  assertExpectedRevision(existing, input, expectedRevision);
  const goal = existing
    ? updateEntity(existing, normalized)
    : (createEntity({ id: makeId(), ...normalized }) as Goal);
  let contributionEntity: GoalContribution | undefined;
  if (contribution) {
    assertPositiveMinor(contribution.amountMinor, "Contribution");
    assertDate(contribution.localDate);
    if (
      contribution.transactionId &&
      !ctx.state.transactions.some(
        (item) => item.id === contribution.transactionId,
      )
    ) {
      throw new Error("Choose a valid transaction.");
    }
    contributionEntity = createEntity({
      id: makeId(),
      ...contribution,
      goalId: goal.id,
      note: contribution.note.trim(),
    }) as GoalContribution;
  }
  const goals = withEntity(ctx.state.goals, goal);
  const contributions = contributionEntity
    ? [...ctx.state.contributions, contributionEntity]
    : ctx.state.contributions;
  assertGoalProgressSafe(ctx, goal.id, goals, contributions);
  return { goal, contributionEntity };
}

/** The contribution `input` saves. */
export function planContributionSave(
  ctx: FinanceContext,
  input: ContributionInput,
  id?: string,
  expectedRevision?: number,
) {
  assertPositiveMinor(input.amountMinor, "Contribution");
  assertDate(input.localDate);
  if (!ctx.state.goals.some((item) => item.id === input.goalId))
    throw new Error("Choose a valid goal.");
  if (
    input.transactionId &&
    !ctx.state.transactions.some((item) => item.id === input.transactionId)
  ) {
    throw new Error("Choose a valid transaction.");
  }
  const existing = findExisting(ctx.state.contributions, id, "contribution");
  assertExpectedRevision(existing, input, expectedRevision);
  const contribution = existing
    ? updateEntity(existing, { ...input, note: input.note.trim() })
    : (createEntity({
        id: makeId(),
        ...input,
        note: input.note.trim(),
      }) as GoalContribution);
  const contributions = withEntity(ctx.state.contributions, contribution);
  assertGoalProgressSafe(ctx, input.goalId, ctx.state.goals, contributions);
  return contribution;
}

/** The manual exchange rate `input` saves. */
export function planExchangeRateSave(
  ctx: FinanceContext,
  input: RateInput,
  id?: string,
  expectedRevision?: number,
) {
  const fromCurrency = normalizeCurrency(input.fromCurrency);
  const toCurrency = normalizeCurrency(input.toCurrency);
  if (fromCurrency === toCurrency)
    throw new Error("Exchange-rate currencies must be different.");
  assertDate(input.effectiveDate);
  const rate = normalizeRate(input.rate);
  const duplicate = ctx.state.exchangeRates.find(
    (item) =>
      item.id !== id &&
      item.fromCurrency === fromCurrency &&
      item.toCurrency === toCurrency &&
      item.effectiveDate === input.effectiveDate,
  );
  if (duplicate) {
    // A manual save landing on the exact key of a live automatic rate gets a more specific
    // message than "a rate already exists" — the manual form is now reached only for
    // currencies Frankfurter does not cover or for resolving a conflict, so the user is
    // looking at a key they did not expect to be occupied.
    if (
      !duplicate.deletedAt &&
      duplicate.id ===
        fetchedRateId(fromCurrency, toCurrency, input.effectiveDate)
    ) {
      throw new Error("An automatic rate already exists for this date.");
    }
    throw new Error("A rate already exists for this currency pair and date.");
  }
  assertReciprocalRate(
    ctx,
    fromCurrency,
    toCurrency,
    rate,
    input.effectiveDate,
    id,
  );
  const existing = findExisting(ctx.state.exchangeRates, id, "exchange rate");
  assertExpectedRevision(existing, input, expectedRevision);
  const exchangeRate = existing
    ? updateEntity(existing, {
        ...input,
        fromCurrency,
        toCurrency,
        rate,
      })
    : (createEntity({
        id: makeId(),
        ...input,
        fromCurrency,
        toCurrency,
        rate,
      }) as ExchangeRate);
  const exchangeRates = withEntity(ctx.state.exchangeRates, exchangeRate);
  assertTransactionSetSafe(
    ctx,
    ctx.state.transactions,
    ctx.state.accounts,
    exchangeRates,
  );
  return exchangeRate;
}
