import { Decimal } from "decimal.js";

import { postedBaseMinor } from "@/data/finance/rates";
import {
  ACCENT_SOURCES,
  ACCOUNT_TYPES,
  assertSafeMinor,
  CATEGORY_KINDS,
  GOAL_KINDS,
  PERIOD_UNITS,
  RECURRENCE_UNITS,
  THEME_MODES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from "@/data/finance/validation";
import type {
  Account,
  Budget,
  BudgetAdjustment,
  BudgetPeriodSnapshot,
  FinanceEntity,
  Goal,
  GoalContribution,
  RecurringRule,
  TransactionRecord,
} from "@/domain/models";
import { repairMergedState } from "@/sync/oplog";
import { isValidThemeId } from "@/theme/themes/types";
import { isLocalDate } from "@/utils/date";
import { validateLocale } from "@/utils/form-validation";
import {
  addMinor,
  convertMinor,
  isSafeMinor,
  isSupportedCurrencyCode,
  subtractMinor,
  sumMinor,
} from "@/utils/money";
import { normalizeFeePercent, totalWithFee } from "@/utils/transaction-amounts";

type MergedState = Parameters<typeof repairMergedState>[0];

/**
 * The overflow gate for a merged set.
 *
 * Deliberately *not* `assertTransactionSetSafe`. That one reads `this.state.goals` and
 * `this.state.settings` and calls `todayLocal()` inside its net-worth pass, so it is not a
 * pure function of its arguments — two devices in different timezones could disagree about
 * whether the same merge is legal, and the op log would fork. This keeps only the passes
 * that depend on nothing but the records in front of them, which is also the cheaper half:
 * no rate resolution, no per-goal walk.
 *
 * Anything it rejects is a merged state no local mutation could have produced, so failing
 * closed here is the whole point — nothing is written and the batch can be retried.
 */
export function assertMergedSetSafe(
  repaired: ReturnType<typeof repairMergedState>,
  formatLocale: string,
) {
  const {
    settings,
    accounts,
    categories,
    tags,
    transactions,
    budgets,
    budgetPeriods,
    budgetAdjustments,
    goals,
    contributions,
    recurringRules,
    exchangeRates,
  } = repaired;
  // Tombstones are erased, so their content is blank by design and validating it would
  // reject every merge that carries a delete. Accounts stay whole: an erased account keeps
  // its type and currency, and the lookups below resolve references through it.
  const liveOnly = <T extends FinanceEntity>(rows: readonly T[]) =>
    rows.filter((row) => !row.deletedAt);
  assertMergedDomainValues(
    {
      settings,
      accounts,
      categories: liveOnly(categories),
      tags: liveOnly(tags),
      transactions: liveOnly(transactions),
      budgets: liveOnly(budgets),
      budgetPeriods: liveOnly(budgetPeriods),
      budgetAdjustments: liveOnly(budgetAdjustments),
      goals: liveOnly(goals),
      contributions: liveOnly(contributions),
      recurringRules: liveOnly(recurringRules),
      exchangeRates: liveOnly(exchangeRates),
    },
    formatLocale,
  );
  const posted = transactions.filter(
    (item) => !item.deletedAt && item.status === "posted",
  );
  for (const account of accounts.filter((item) => !item.deletedAt)) {
    const label = `${account.name} balance`;
    let balance = account.openingBalanceMinor;
    assertSafeMinor(balance, label);
    for (const transaction of posted) {
      if (transaction.accountId === account.id) {
        balance =
          transaction.kind === "income"
            ? addMinor(balance, transaction.amountMinor, label)
            : subtractMinor(balance, transaction.amountMinor, label);
      }
      if (
        transaction.kind === "transfer" &&
        transaction.destinationAccountId === account.id
      ) {
        balance = addMinor(
          balance,
          transaction.destinationAmountMinor ?? 0,
          label,
        );
      }
    }
  }
  sumMinor(
    posted
      .filter((item) => item.kind === "income")
      .map((item) => postedBaseMinor(item)),
    "Income total",
  );
  sumMinor(
    posted
      .filter((item) => item.kind === "expense")
      .map((item) => postedBaseMinor(item)),
    "Expense total",
  );
}

// ---- Field checks ----------------------------------------------------------------------------

const assertText = (value: unknown, label: string) => {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
};
const assertCalendarDate = (value: unknown, label: string) => {
  if (typeof value !== "string" || !isLocalDate(value))
    throw new Error(`${label} must be a calendar date.`);
};
const assertMinor = (value: unknown, label: string, positive = false) => {
  if (
    typeof value !== "number" ||
    !isSafeMinor(value) ||
    (positive && value <= 0)
  ) {
    throw new Error(
      `${label} must be ${positive ? "a positive " : "a "}safe minor-unit integer.`,
    );
  }
};
const assertCurrency = (value: unknown, label: string) => {
  if (typeof value !== "string" || !isSupportedCurrencyCode(value)) {
    throw new Error(`${label} must be a supported currency.`);
  }
};
const assertEnum = (
  value: unknown,
  values: readonly string[],
  label: string,
) => {
  if (typeof value !== "string" || !values.includes(value))
    throw new Error(`${label} is invalid.`);
};
const assertRate = (value: unknown, label: string) => {
  if (typeof value !== "string")
    throw new Error(`${label} must be a decimal string.`);
  let rate: Decimal;
  try {
    rate = new Decimal(value);
  } catch {
    throw new Error(`${label} must be a decimal string.`);
  }
  if (!rate.isFinite() || rate.lte(0))
    throw new Error(`${label} must be positive.`);
};

/**
 * Remote ops are authenticated, not inherently valid finance input. This is deliberately
 * pure and complete enough to reject every value shape that the local mutation paths refuse,
 * before a malformed projection is allowed to poison future local saves.
 */
function assertMergedDomainValues(
  {
    settings,
    accounts,
    categories,
    tags,
    transactions,
    budgets,
    budgetPeriods,
    budgetAdjustments,
    goals,
    contributions,
    recurringRules,
    exchangeRates,
  }: MergedState,
  formatLocale: string,
) {
  assertSettingsValues(settings);
  assertAccountValues(accounts);
  for (const category of categories)
    assertEnum(category.kind, CATEGORY_KINDS, "Category kind");
  for (const tag of tags) assertText(tag.name, "Tag name");
  for (const transaction of transactions)
    assertTransactionValues(transaction, accounts, formatLocale);
  for (const budget of budgets) assertBudgetValues(budget);
  for (const period of budgetPeriods) assertBudgetPeriodValues(period);
  for (const adjustment of budgetAdjustments)
    assertBudgetAdjustmentValues(adjustment);
  for (const goal of goals) assertGoalValues(goal);
  for (const contribution of contributions)
    assertContributionValues(contribution);
  for (const rule of recurringRules) assertRecurringRuleValues(rule, accounts);
  for (const rate of exchangeRates) assertExchangeRateValues(rate);
}

function assertSettingsValues(settings: MergedState["settings"]) {
  // A freshly paired device can receive account and transaction history before its settings
  // create reaches it. Hold the settings-specific checks until that create lands rather than
  // rejecting otherwise well-formed history.
  if (settings) {
    assertCurrency(settings.baseCurrency, "Base currency");
    if (!isValidThemeId(settings.themeId)) throw new Error("Theme is invalid.");
    assertEnum(settings.themeMode, THEME_MODES, "Theme mode");
    assertEnum(settings.accentSource, ACCENT_SOURCES, "Accent source");
    if (validateLocale(settings.locale))
      throw new Error("Settings locale is invalid.");
  }
}

function assertAccountValues(accounts: readonly Account[]) {
  for (const account of accounts) {
    assertEnum(account.type, ACCOUNT_TYPES, "Account type");
    assertCurrency(account.currency, "Account currency");
    assertMinor(account.openingBalanceMinor, "Opening balance");
  }
}

function assertTransactionValues(
  transaction: TransactionRecord,
  accounts: readonly Account[],
  formatLocale: string,
) {
  assertEnum(transaction.kind, TRANSACTION_TYPES, "Transaction type");
  assertEnum(transaction.status, TRANSACTION_STATUSES, "Transaction status");
  assertCalendarDate(transaction.localDate, "Transaction date");
  assertMinor(transaction.amountMinor, "Transaction amount", true);
  assertCurrency(transaction.currency, "Transaction currency");
  assertPricingSnapshot(transaction);
  const source = accounts.find(
    (account) => account.id === transaction.accountId,
  );
  if (!source || source.currency !== transaction.currency)
    throw new Error("Transaction currency must match its account.");
  assertTransferFields(transaction, accounts);
  assertForeignAndFee(transaction, formatLocale);
}

function assertPricingSnapshot(transaction: TransactionRecord) {
  // The rate snapshot is null only while the row is unpriced (never posted). Both fields are
  // null together; a posted row always carries its snapshot.
  if (
    transaction.exchangeRate === null ||
    transaction.baseAmountMinor === null
  ) {
    if (
      transaction.exchangeRate !== null ||
      transaction.baseAmountMinor !== null
    )
      throw new Error(
        "Transaction exchange rate and base amount must be set together.",
      );
    if (transaction.status === "posted")
      throw new Error("Posted transactions need an exchange rate.");
  } else {
    assertMinor(transaction.baseAmountMinor, "Transaction base amount", true);
    assertRate(transaction.exchangeRate, "Transaction exchange rate");
  }
}

function assertTransferFields(
  transaction: TransactionRecord,
  accounts: readonly Account[],
) {
  if (transaction.kind === "transfer") {
    const destination = accounts.find(
      (account) => account.id === transaction.destinationAccountId,
    );
    if (
      !destination ||
      transaction.destinationAmountMinor === null ||
      (transaction.destinationBaseAmountMinor === null &&
        transaction.status === "posted") ||
      transaction.destinationCurrency !== destination.currency
    ) {
      throw new Error("Transfer destination does not match its account.");
    }
    assertMinor(
      transaction.destinationAmountMinor,
      "Transfer destination amount",
      true,
    );
    // Unpriced (not yet paid) legs carry no destination base amount until they are paid.
    if (transaction.destinationBaseAmountMinor !== null)
      assertMinor(
        transaction.destinationBaseAmountMinor,
        "Transfer destination base amount",
        true,
      );
  } else if (
    transaction.destinationAccountId !== null ||
    transaction.destinationAmountMinor !== null ||
    transaction.destinationBaseAmountMinor !== null ||
    transaction.destinationCurrency !== null ||
    transaction.transferGroupId !== null
  ) {
    throw new Error("Non-transfer transaction has transfer fields.");
  }
}

function assertForeignAndFee(
  transaction: TransactionRecord,
  formatLocale: string,
) {
  const foreign = transaction.foreign ?? null;
  const fee = transaction.fee ?? null;
  if (transaction.kind === "transfer") {
    if (foreign || fee)
      throw new Error(
        "Foreign amounts and fees apply to expenses and income only.",
      );
  } else {
    let principal = transaction.amountMinor;
    if (foreign) {
      assertCurrency(foreign.currency, "Transaction foreign currency");
      if (foreign.currency === transaction.currency) {
        throw new Error(
          "Choose a foreign currency different from the account’s.",
        );
      }
      assertMinor(foreign.amountMinor, "Transaction foreign amount", true);
      assertRate(foreign.exchangeRate, "Transaction foreign exchange rate");
      principal = convertMinor(
        foreign.amountMinor,
        foreign.currency,
        transaction.currency,
        foreign.exchangeRate,
        formatLocale,
      );
    }
    if (fee) {
      assertEnum(fee.kind, ["percent", "fixed"], "Transaction fee kind");
      if (
        typeof fee.amountMinor !== "number" ||
        !isSafeMinor(fee.amountMinor) ||
        fee.amountMinor < 0
      ) {
        throw new Error(
          "Transaction fee amount must be a safe minor-unit integer.",
        );
      }
      if (fee.kind === "percent") {
        if (typeof fee.percent !== "string")
          throw new Error("Transaction fee percent is invalid.");
        normalizeFeePercent(fee.percent);
      } else if (fee.percent !== null) {
        throw new Error(
          "Transaction fee percent must be null for a fixed fee.",
        );
      }
    }
    const expectedAmountMinor = fee
      ? totalWithFee(transaction.kind, principal, fee.amountMinor)
      : principal;
    if (transaction.amountMinor !== expectedAmountMinor) {
      throw new Error(
        "Transaction amount does not match its principal and fee.",
      );
    }
  }
}

function assertBudgetValues(budget: Budget) {
  assertMinor(budget.limitMinor, "Budget limit", true);
  assertEnum(budget.period.unit, PERIOD_UNITS, "Budget period");
  assertCalendarDate(budget.period.anchorDate, "Budget anchor date");
  if (
    !Number.isSafeInteger(budget.period.interval) ||
    budget.period.interval < 1
  )
    throw new Error("Budget interval is invalid.");
  if (
    budget.period.unit === "custom" &&
    (!budget.period.endDate || !isLocalDate(budget.period.endDate))
  )
    throw new Error("Custom budget end date is invalid.");
  for (const limit of budget.categoryLimits)
    assertMinor(limit.limitMinor, "Budget category limit", true);
}

function assertBudgetPeriodValues(period: BudgetPeriodSnapshot) {
  assertCalendarDate(period.periodStart, "Budget period start");
  assertCalendarDate(period.periodEnd, "Budget period end");
  assertMinor(period.limitMinor, "Budget period limit", true);
  assertMinor(period.rolloverMinor, "Budget period rollover");
}

function assertBudgetAdjustmentValues(adjustment: BudgetAdjustment) {
  assertCalendarDate(adjustment.date, "Budget adjustment date");
  assertMinor(adjustment.amountMinor, "Budget adjustment amount");
  if (adjustment.amountMinor === 0)
    throw new Error("Budget adjustment amount cannot be zero.");
  assertText(adjustment.note, "Budget adjustment note");
}

function assertGoalValues(goal: Goal) {
  assertEnum(goal.kind, GOAL_KINDS, "Goal kind");
  assertMinor(goal.targetMinor, "Goal target", true);
  assertMinor(goal.initialMinor, "Goal initial progress");
  if (goal.initialMinor < 0)
    throw new Error("Goal initial progress cannot be negative.");
  if (goal.targetDate !== null)
    assertCalendarDate(goal.targetDate, "Goal target date");
}

function assertContributionValues(contribution: GoalContribution) {
  assertMinor(contribution.amountMinor, "Contribution amount", true);
  assertCalendarDate(contribution.localDate, "Contribution date");
}

function assertRecurringRuleValues(
  rule: RecurringRule,
  accounts: readonly Account[],
) {
  assertEnum(rule.template.kind, CATEGORY_KINDS, "Recurring transaction type");
  assertCurrency(rule.template.currency, "Recurring transaction currency");
  assertMinor(rule.template.amountMinor, "Recurring transaction amount", true);
  assertEnum(rule.unit, RECURRENCE_UNITS, "Recurring period");
  if (!Number.isSafeInteger(rule.interval) || rule.interval < 1)
    throw new Error("Recurring interval is invalid.");
  assertCalendarDate(rule.startDate, "Recurring start date");
  assertCalendarDate(rule.nextDueDate, "Recurring next date");
  if (rule.endDate !== null)
    assertCalendarDate(rule.endDate, "Recurring end date");
  const account = accounts.find((item) => item.id === rule.template.accountId);
  if (!account || account.currency !== rule.template.currency)
    throw new Error("Recurring currency must match its account.");
  const templateForeign = rule.template.foreign ?? null;
  if (templateForeign) {
    assertCurrency(templateForeign.currency, "Recurring foreign currency");
    if (templateForeign.currency === rule.template.currency) {
      throw new Error(
        "Choose a foreign currency different from the account’s.",
      );
    }
    assertMinor(templateForeign.amountMinor, "Recurring foreign amount", true);
    if (templateForeign.exchangeRate !== undefined)
      assertRate(
        templateForeign.exchangeRate,
        "Recurring foreign exchange rate",
      );
  }
  const templateFee = rule.template.fee ?? null;
  if (templateFee) {
    assertEnum(templateFee.kind, ["percent", "fixed"], "Recurring fee kind");
    if (templateFee.kind === "fixed") {
      assertMinor(templateFee.amountMinor, "Recurring fee amount", true);
    } else {
      if (typeof templateFee.percent !== "string")
        throw new Error("Recurring fee percent is invalid.");
      normalizeFeePercent(templateFee.percent);
    }
  }
}

function assertExchangeRateValues(rate: MergedState["exchangeRates"][number]) {
  assertCurrency(rate.fromCurrency, "Exchange-rate source currency");
  assertCurrency(rate.toCurrency, "Exchange-rate destination currency");
  assertCalendarDate(rate.effectiveDate, "Exchange-rate date");
  assertRate(rate.rate, "Exchange rate");
}
