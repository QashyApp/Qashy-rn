import { assertGoalProgressSafe } from "@/data/finance/analytics";
import type { FinanceContext } from "@/data/finance/context";
import { postedBaseMinor, resolveRate } from "@/data/finance/rates";
import { assertSafeMinor } from "@/data/finance/validation";
import type { TransactionRecord } from "@/domain/models";
import { todayLocal } from "@/utils/date";
import { addMinor, convertMinor, subtractMinor } from "@/utils/money";

/**
 * The overflow gate for a local change: the balances, income and expense totals, goal progress and
 * net worth that remain once `transactions` (and optionally `accounts` and `exchangeRates`) are in
 * place must all stay representable. Reads the live snapshot for what it is not given, so it is
 * not a pure function of its arguments; a merge uses `assertMergedSetSafe` instead.
 */
export function assertTransactionSetSafe(
  ctx: FinanceContext,
  transactions: TransactionRecord[],
  accounts = ctx.state.accounts,
  exchangeRates = ctx.state.exchangeRates,
) {
  // One pass over the transactions. Each account's running balance sees exactly the operations
  // the old per-account loop applied, in the same order, so overflow is detected identically
  // — but the cost is O(transactions + accounts) instead of O(accounts × transactions).
  const activeAccounts = accounts.filter((item) => !item.deletedAt);
  const balances = new Map<string, number>();
  const names = new Map<string, string>();
  for (const account of activeAccounts) {
    assertSafeMinor(account.openingBalanceMinor, `${account.name} balance`);
    balances.set(account.id, account.openingBalanceMinor);
    names.set(account.id, account.name);
  }
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const transaction of transactions) {
    if (transaction.deletedAt || transaction.status !== "posted") continue;
    const source = balances.get(transaction.accountId);
    if (source !== undefined) {
      const label = `${names.get(transaction.accountId)} balance`;
      balances.set(
        transaction.accountId,
        transaction.kind === "income"
          ? addMinor(source, transaction.amountMinor, label)
          : subtractMinor(source, transaction.amountMinor, label),
      );
    }
    if (transaction.kind === "transfer" && transaction.destinationAccountId) {
      const destination = balances.get(transaction.destinationAccountId);
      if (destination !== undefined) {
        balances.set(
          transaction.destinationAccountId,
          addMinor(
            destination,
            transaction.destinationAmountMinor ?? 0,
            `${names.get(transaction.destinationAccountId)} balance`,
          ),
        );
      }
    }
    if (transaction.kind === "income") {
      incomeTotal = addMinor(
        incomeTotal,
        postedBaseMinor(transaction),
        "Income total",
      );
    } else if (transaction.kind === "expense") {
      expenseTotal = addMinor(
        expenseTotal,
        postedBaseMinor(transaction),
        "Expense total",
      );
    }
  }
  ctx.state.goals.forEach((goal) => {
    assertGoalProgressSafe(
      ctx,
      goal.id,
      ctx.state.goals,
      ctx.state.contributions,
      transactions,
    );
  });
  let netWorth = 0;
  // Archived accounts are included so this overflow guard covers exactly the
  // set `getDashboard` now sums, rather than a narrower one.
  for (const account of activeAccounts) {
    let rate: string;
    try {
      rate = resolveRate(
        ctx,
        account.currency,
        ctx.state.settings.baseCurrency,
        todayLocal(),
        exchangeRates,
      );
    } catch {
      continue;
    }
    netWorth = addMinor(
      netWorth,
      convertMinor(
        balances.get(account.id) ?? account.openingBalanceMinor,
        account.currency,
        ctx.state.settings.baseCurrency,
        rate,
        ctx.formatLocale,
      ),
      "Net worth",
    );
  }
}
