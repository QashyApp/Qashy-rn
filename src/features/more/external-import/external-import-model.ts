import type { RatePair } from "@/data/exchange-rates/rate-service";
import { type ImportBundle } from "@/data/import/types";

export type Stage = "source" | "file" | "review" | "done";

export const STAGES: readonly Stage[] = ["source", "file", "review", "done"];

/**
 * The currency/date pairs an external bundle needs a rate for before its preview: each posted
 * row converts from its account's currency, and a transfer also from its destination account's.
 * Upcoming and skipped rows need no rate yet, and the base currency never does. Recurring
 * catch-up is not included; its occurrence dates are not derivable from the bundle alone.
 */
export function externalImportRatePairs(
  bundle: ImportBundle,
  baseCurrency: string,
): RatePair[] {
  const base = baseCurrency.trim().toUpperCase();
  const currencyByAccount = new Map<string, string>(
    bundle.accounts.map((account): [string, string] => [
      account.externalId,
      account.currency.trim().toUpperCase(),
    ]),
  );
  const seen = new Set<string>();
  const pairs: RatePair[] = [];
  const add = (accountExternalId: string | null, localDate: string) => {
    const currency =
      accountExternalId === null
        ? undefined
        : currencyByAccount.get(accountExternalId);
    if (!currency || currency === base) return;
    const key = `${currency}|${localDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ currency, localDate });
  };
  for (const transaction of bundle.transactions) {
    if (transaction.status !== "posted") continue;
    add(transaction.accountExternalId, transaction.localDate);
    add(transaction.destinationAccountExternalId, transaction.localDate);
  }
  return pairs;
}
