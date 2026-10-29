/**
 * Shared dashboard-summary fetch for the screens that show one.
 *
 * `repository.getDashboard` is a synchronous read over the in-memory finance snapshot, so this
 * just centralizes the `useMemo` + external-store dependency list that every caller would
 * otherwise duplicate, all reading the same state slices the repository consults internally.
 *
 * Overview calls it once per month page and passes the result to its widgets as `summary`
 * (see `WidgetProps`), so the cards never each run the same read themselves.
 */

import { useMemo } from "react";

import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { endOfMonth, startOfMonth, toLocalDate } from "@/utils/date";
import { useNow } from "@/hooks/use-now";

export function useDashboardRange(fromDate: string, toDate: string) {
  // The React Compiler drops the `void state.x` reads below as dead code and then memoizes on
  // `repository` and the dates alone, so the summary (and the Coming up / Recent lists built from
  // it) never recomputed after a mutation until a reload. The explicit dependency list is the
  // contract here; keep the compiler out of this hook.
  "use no memo";
  const repository = useFinanceRepository();
  const state = useFinanceState();
  // `getDashboard` depends on today (budget date, net-worth rate date, upcoming list).
  const today = toLocalDate(new Date(useNow()));
  return useMemo(() => {
    // Repository reads are synchronous; these references make their external-store inputs explicit.
    void today;
    void state.accounts;
    void state.budgetPeriods;
    void state.budgetAdjustments;
    void state.budgets;
    void state.categories;
    void state.exchangeRates;
    void state.settings;
    void state.transactions;
    return repository.getDashboard(fromDate, toDate);
  }, [
    repository,
    fromDate,
    toDate,
    today,
    state.accounts,
    state.budgetPeriods,
    state.budgetAdjustments,
    state.budgets,
    state.categories,
    state.exchangeRates,
    state.settings,
    state.transactions,
  ]);
}

export function useDashboard(month: string) {
  return useDashboardRange(startOfMonth(month), endOfMonth(month));
}
