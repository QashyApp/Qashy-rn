import type { FinanceRepository } from "@/data/repository";
import type { ExchangeRateService } from "@/data/exchange-rates/rate-service";
import type { TransactionRecord } from "@/domain/models";
import { todayLocal } from "@/utils/date";

/** The currencies an upcoming transaction is priced in: its account's, and a transfer's destination. */
export function upcomingCurrencies(
  transaction: Pick<TransactionRecord, "currency" | "destinationCurrency">,
): string[] {
  return [transaction.currency, transaction.destinationCurrency].filter(
    (currency): currency is string => Boolean(currency),
  );
}

/**
 * Marks an upcoming transaction paid. Paying snapshots today's rate for a transaction that has none
 * yet, so the current rates are fetched first. The fetch never throws, and a rate that still cannot
 * be found makes `confirmUpcoming` reject with "Missing exchange rate", which the caller reports while
 * the transaction stays upcoming.
 */
export async function markUpcomingPaid(
  repository: FinanceRepository,
  rates: ExchangeRateService,
  id: string,
  currencies: readonly string[],
): Promise<void> {
  const today = todayLocal();
  await rates
    .ensureRatesFor(
      currencies.map((currency) => ({ currency, localDate: today })),
    )
    .catch(() => undefined);
  await repository.confirmUpcoming(id);
}
