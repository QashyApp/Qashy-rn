/**
 * Shared dashboard-summary fetch for every Overview widget.
 *
 * `repository.getDashboard` is a synchronous read over the in-memory finance snapshot, so this
 * just centralizes the `useMemo` + external-store dependency list every widget on the current
 * screen used to duplicate — one copy instead of six, all reading the same state slices the
 * repository consults internally.
 */

import { useMemo } from 'react';

import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { endOfMonth, startOfMonth } from '@/utils/date';

export function useDashboard(month: string) {
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
    return repository.getDashboard(startOfMonth(month), endOfMonth(month));
  }, [repository, month, state.accounts, state.budgetPeriods, state.budgetAdjustments, state.budgets, state.categories, state.exchangeRates, state.settings, state.transactions]);
}
