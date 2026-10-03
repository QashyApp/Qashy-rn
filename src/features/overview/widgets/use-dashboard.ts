/**
 * Shared dashboard-summary fetch for every screen and Overview widget.
 *
 * `repository.getDashboard` is a synchronous read over the in-memory finance snapshot, so this
 * just centralizes the `useMemo` + external-store dependency list every caller used to duplicate —
 * one copy instead of many, all reading the same state slices the repository consults internally.
 */

import { useMemo } from "react";

import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { endOfMonth, startOfMonth } from "@/utils/date";

export function useDashboardRange(fromDate: string, toDate: string) {
  // The React Compiler drops the `void state.x` reads below as dead code and then memoizes on
  // `repository` and the dates alone, so the summary (and the Coming up / Recent lists built from
  // it) never recomputed after a mutation until a reload. The explicit dependency list is the
  // contract here; keep the compiler out of this hook.
  "use no memo";
  const repository = useFinanceRepository();
  const state = useFinanceState();
  return useMemo(() => {
    // Repository reads are synchronous; these references make their external-store inputs explicit.
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
