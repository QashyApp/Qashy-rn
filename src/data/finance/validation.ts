import { Decimal } from "decimal.js";

import type { FinanceContext } from "@/data/finance/context";
import type { Account, Category, FinanceEntity, Tag } from "@/domain/models";
import type { BudgetInput, GoalInput } from "@/data/repository";
import { isLocalDate } from "@/utils/date";
import { validateLocale } from "@/utils/form-validation";
import { normalizeName } from "@/utils/naming";
import { isSafeMinor, isSupportedCurrencyCode } from "@/utils/money";

export const ACCOUNT_TYPES = [
  "cash",
  "checking",
  "savings",
  "credit",
  "wallet",
] as const;
export const CATEGORY_KINDS = ["expense", "income"] as const;
export const GOAL_KINDS = ["saving", "spending"] as const;
export const TRANSACTION_TYPES = ["expense", "income", "transfer"] as const;
export const TRANSACTION_STATUSES = ["posted", "upcoming", "skipped"] as const;
export const PERIOD_UNITS = ["day", "week", "month", "year", "custom"] as const;
export const RECURRENCE_UNITS = ["day", "week", "month", "year"] as const;
export const THEME_MODES = ["system", "light", "dark"] as const;
export const ACCENT_SOURCES = ["system", "preset", "custom"] as const;

// ---- Field checks and normalizers ------------------------------------------------------------

export function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Use a three-letter currency code such as USD.");
  if (!isSupportedCurrencyCode(currency))
    throw new Error("Use a supported ISO 4217 currency code.");
  return currency;
}

export function normalizeRate(value: string) {
  let rate: Decimal;
  try {
    rate = new Decimal(value.trim());
  } catch {
    throw new Error("Exchange rate must be a positive number.");
  }
  if (!rate.isFinite() || rate.lte(0))
    throw new Error("Exchange rate must be a positive number.");
  // `toFixed`, not `toString`: decimal.js switches to exponential notation below
  // 1e-7 (`toExpNeg`), which real pairs such as IRR→BHD reach. Rates are stored as
  // decimal strings, and `normalizeDecimalString` would reject "8.9e-9" if such a
  // value were ever fed back through form input.
  return rate.toSignificantDigits(20).toFixed();
}

export function assertLocale(value: string) {
  const error = validateLocale(value);
  if (error) throw new Error(error);
}

export function assertColor(value: string) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value))
    throw new Error("Use a six-digit hex color such as #5070FF.");
}

export function assertDate(value: string) {
  if (!isLocalDate(value))
    throw new Error("Use a real date in YYYY-MM-DD format.");
}

export function assertSafeMinor(value: number, label: string) {
  if (!isSafeMinor(value))
    throw new Error(`${label} is outside the supported range.`);
}

export function assertPositiveMinor(value: number, label: string) {
  assertSafeMinor(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than zero.`);
}

export function parseMinorInteger(value: string, label: string) {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized))
    throw new Error(`${label} must be a whole number.`);
  const parsed = Number(normalized);
  assertSafeMinor(parsed, label);
  return parsed;
}

/** Nothing is archived any more. A record an older build archived may still be saved as it is. */
export function assertNotArchiving(
  wantsArchived: boolean,
  wasArchived = false,
) {
  if (wantsArchived && !wasArchived)
    throw new Error("Nothing can be archived. Delete it instead.");
}

// ---- Lookups on the snapshot -----------------------------------------------------------------

export function findExisting<T extends FinanceEntity>(
  entities: T[],
  id: string | undefined,
  label: string,
) {
  if (!id) return undefined;
  const existing = entities.find((item) => item.id === id);
  if (!existing) throw new Error(`Could not find the ${label} to update.`);
  return existing;
}

export function assertExpectedRevision(
  existing: FinanceEntity | undefined,
  _input: object,
  expectedRevision?: number,
) {
  if (!existing) return;
  if (
    expectedRevision !== undefined &&
    expectedRevision !== existing.revision
  ) {
    throw new Error(
      "This record changed in another window. Reopen it and try again.",
    );
  }
}

export function assertUniqueName(
  ctx: FinanceContext,
  type: "accounts" | "categories" | "tags",
  name: string,
  id?: string,
) {
  // `normalizeName` rather than `toLocaleLowerCase`, and the same one `disambiguateNames`
  // uses. Case folding is locale-dependent — in a Turkish locale `'I'` folds to `'ı'` —
  // so the two would otherwise disagree about what counts as a collision, and a set the
  // load migration had just declared clean could still be rejected by every later save.
  const duplicate = (ctx.state[type] as (Account | Category | Tag)[]).some(
    (item) =>
      item.id !== id && normalizeName(item.name) === normalizeName(name),
  );
  if (duplicate) throw new Error(`${name} is already in use.`);
}

export function assertIdsExist<T extends FinanceEntity>(
  ids: string[],
  entities: T[],
  label: string,
) {
  const known = new Set(entities.map((item) => item.id));
  if (ids.some((id) => !known.has(id)))
    throw new Error(`Choose valid ${label} values.`);
}

// ---- Whole-input validators ------------------------------------------------------------------

export function validateBudget(
  ctx: FinanceContext,
  input: BudgetInput,
): BudgetInput {
  assertPositiveMinor(input.limitMinor, "Budget limit");
  assertDate(input.period.anchorDate);
  if (
    !Number.isSafeInteger(input.period.interval) ||
    input.period.interval < 1
  ) {
    throw new Error("Budget interval must be a positive whole number.");
  }
  if (!PERIOD_UNITS.includes(input.period.unit))
    throw new Error("Choose a valid budget period.");
  if (input.period.unit === "custom") {
    if (!input.period.endDate)
      throw new Error("Custom budgets require an end date.");
    assertDate(input.period.endDate);
    if (input.period.endDate < input.period.anchorDate)
      throw new Error("Budget end date must not precede its start date.");
  }
  assertIdsExist(input.filters.accountIds, ctx.state.accounts, "account");
  assertIdsExist(input.filters.tagIds, ctx.state.tags, "tag");
  assertIdsExist(
    input.filters.categoryIds,
    ctx.state.categories.filter((item) => item.kind === "expense"),
    "expense category",
  );
  const limitedCategories = new Set<string>();
  input.categoryLimits.forEach((limit) => {
    assertPositiveMinor(limit.limitMinor, "Category limit");
    if (limitedCategories.has(limit.categoryId))
      throw new Error("Each category can have only one limit.");
    limitedCategories.add(limit.categoryId);
    if (!input.filters.categoryIds.includes(limit.categoryId)) {
      throw new Error("Category limits must belong to the budget filters.");
    }
  });
  assertColor(input.color);
  return {
    ...input,
    name: input.name.trim() || "Budget",
    color: input.color.toUpperCase(),
    filters: {
      accountIds: [...new Set(input.filters.accountIds)],
      categoryIds: [...new Set(input.filters.categoryIds)],
      tagIds: [...new Set(input.filters.tagIds)],
    },
    categoryLimits: input.categoryLimits.map((limit) => ({ ...limit })),
    period: {
      ...input.period,
      endDate: input.period.unit === "custom" ? input.period.endDate : null,
    },
  };
}

export function validateGoal(
  ctx: FinanceContext,
  input: GoalInput,
  id?: string,
): GoalInput {
  const existing = findExisting(ctx.state.goals, id, "goal");
  if (!GOAL_KINDS.includes(input.kind))
    throw new Error("Choose a valid goal kind.");
  assertPositiveMinor(input.targetMinor, "Goal target");
  assertSafeMinor(input.initialMinor, "Starting progress");
  if (input.initialMinor < 0)
    throw new Error("Starting progress cannot be negative.");
  if (input.targetDate) assertDate(input.targetDate);
  if (input.linkedAccountId) {
    const account = ctx.state.accounts.find(
      (item) => item.id === input.linkedAccountId,
    );
    if (
      !account ||
      (account.archived && existing?.linkedAccountId !== account.id)
    ) {
      throw new Error("Choose a valid linked account.");
    }
  }
  if (input.linkedCategoryId) {
    const expectedKind = input.kind === "saving" ? "income" : "expense";
    const category = ctx.state.categories.find(
      (item) => item.id === input.linkedCategoryId,
    );
    if (
      !category ||
      category.kind !== expectedKind ||
      (category.archived && existing?.linkedCategoryId !== category.id)
    ) {
      throw new Error(`Choose a valid ${expectedKind} category.`);
    }
  }
  assertColor(input.color);
  return {
    ...input,
    name: input.name.trim() || "Goal",
    color: input.color.toUpperCase(),
  };
}
