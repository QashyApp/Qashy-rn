import type { FinanceState, RecurringRule } from "@/domain/models";
import { convertMinor } from "@/utils/money";
import { appliedCrossRateFor } from "@/utils/rates";

export interface RecurringDisplayAmount {
  amountMinor: number;
  currency: string;
  /**
   * True when the schedule is in a foreign currency with no rate to price it yet: the figure is
   * the foreign amount itself, not an estimate in the account's currency.
   */
  unpriced: boolean;
}

/**
 * What to show as a schedule's amount. A foreign-currency schedule saved without a rate keeps its
 * foreign amount as the stored `template.amountMinor` (an estimate that must stay positive), but
 * that number is in the foreign currency while `template.currency` is the account's. So an
 * explicit rate uses the stored estimate, an unpinned rate is priced from the rates stored today
 * (the date the next occurrence will use), and with no rate the foreign amount is shown as is.
 */
export function recurringDisplayAmount(
  rule: Pick<RecurringRule, "template" | "nextDueDate">,
  state: FinanceState,
  locale: string,
): RecurringDisplayAmount {
  const { template } = rule;
  const foreign = template.foreign;
  if (!foreign || foreign.exchangeRate)
    return {
      amountMinor: template.amountMinor,
      currency: template.currency,
      unpriced: false,
    };
  const applied = appliedCrossRateFor(
    state,
    foreign.currency,
    template.currency,
    rule.nextDueDate,
  );
  if (!applied)
    return {
      amountMinor: foreign.amountMinor,
      currency: foreign.currency,
      unpriced: true,
    };
  return {
    amountMinor: convertMinor(
      foreign.amountMinor,
      foreign.currency,
      template.currency,
      applied.rate,
      locale,
    ),
    currency: template.currency,
    unpriced: false,
  };
}
