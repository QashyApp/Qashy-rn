/**
 * Entity ids derived from a natural key instead of a random source.
 *
 * Two paired devices run `generateRecurring()` on every foreground and roll a budget over
 * on the first of the month independently. With `makeId()` that produces two entities for
 * one real-world thing, and the merge then has to notice the duplicate and tombstone one of
 * them — a repair that has to be right on both devices, every time, forever.
 *
 * Deriving the id from the key that already identifies the occurrence removes the problem
 * rather than resolving it: both devices mint the *same* id, so the two generations merge
 * into one entity by construction. No duplicate, no tombstone, no repair pass, and it fixes
 * the same double-generation race that exists today on a single device whenever two
 * foregrounds overlap.
 *
 * The hash is what makes it safe to do this. Using the natural key as the id directly would
 * leak it: a budget period id would spell out a budget id and a date, and a transaction id
 * would spell out a recurring rule id. Ids reach places record contents do not — React keys,
 * routes, the CSV export — so they are kept opaque.
 */

import { sha256, toHex, utf8Bytes } from "@/sync/crypto";

/**
 * Namespaces, so two different key spaces can never derive the same id.
 *
 * A budget period keyed `x:2026-07-01` and a recurrence occurrence keyed `x:2026-07-01` are
 * unrelated things that happen to spell the same string; without the namespace they would
 * be the same entity id in two different tables.
 */
export const ID_NAMESPACES = {
  budgetPeriod: "qashy/id/v1/budget-period",
  occurrence: "qashy/id/v1/occurrence",
  fetchedRate: "qashy/id/v1/fetched-rate",
  externalImport: "qashy/id/v1/external-import",
} as const;

export type IdNamespace = (typeof ID_NAMESPACES)[keyof typeof ID_NAMESPACES];

/**
 * A stable UUID for `parts` within `namespace`.
 *
 * Every part is length-prefixed rather than joined with a delimiter. Any character used as a
 * separator can also occur in a part, and then `('a', 'b:c')` and `('a:b', 'c')` hash to the
 * same id — which is not hypothetical: a budget period is keyed by a budget id and a date,
 * and reading that boundary wrong would silently make two different periods one entity. A
 * length prefix is injective without reserving a character at all.
 *
 * Formatted as an RFC 9562 version 8 UUID — the "custom" version, reserved for exactly this
 * case, where the bits come from an application-defined derivation rather than a random
 * source. Stamping the version and variant nibbles keeps the value a well-formed UUID and
 * makes it impossible to collide with a version 4 id from `makeId()`, so a derived id and a
 * random one can always be told apart after the fact.
 */
export function deterministicId(
  namespace: IdNamespace,
  ...parts: readonly string[]
) {
  const framed = [namespace, ...parts]
    .map((part) => `${part.length}:${part}`)
    .join("");
  const digest = toHex(sha256(utf8Bytes(framed)));
  const variant = ((parseInt(digest[16], 16) & 0b0011) | 0b1000).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `8${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

/** The id every device gives the transaction generated for one recurrence occurrence. */
export const occurrenceTransactionId = (occurrenceKey: string) =>
  deterministicId(ID_NAMESPACES.occurrence, occurrenceKey);

/** The id every device gives the snapshot of one budget's one period. */
export const budgetPeriodId = (budgetId: string, periodStart: string) =>
  deterministicId(ID_NAMESPACES.budgetPeriod, budgetId, periodStart);

/**
 * The id every device gives the automatically fetched rate for one currency pair and date.
 *
 * Two devices that fetch the same day's rate independently — the common case, since both
 * refresh on every foreground — mint the *same* entity rather than two rows a merge then has
 * to notice are duplicates. `local-finance-repository.ts` also uses this to answer "is this row
 * one we fetched?": a row is a fetched rate exactly when its id equals
 * `fetchedRateId(row.fromCurrency, row.toCurrency, row.effectiveDate)`. There is no separate
 * model field for it.
 */
export const fetchedRateId = (
  from: string,
  to: string,
  effectiveDate: string,
) => deterministicId(ID_NAMESPACES.fetchedRate, from, to, effectiveDate);

/**
 * True exactly when `rate` is one `saveFetchedRates` wrote — its id is the deterministic hash
 * of its own (from, to, effectiveDate), not a random one. There is no stored field for this;
 * every caller that needs to tell an automatic row from a legacy manual one (the "Exchange
 * rates" screen, `appliedRateFor`) checks it this way instead.
 */
export function isFetchedRate(rate: {
  readonly id: string;
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly effectiveDate: string;
}): boolean {
  return (
    rate.id ===
    fetchedRateId(rate.fromCurrency, rate.toCurrency, rate.effectiveDate)
  );
}

/** Entity kinds an import derives ids for; part of the id, so an account and a tag can share an external id. */
export type ExternalImportEntityType =
  | "account"
  | "category"
  | "tag"
  | "transaction"
  | "recurringRule"
  | "budget"
  | "transfer-group";

/**
 * The id every device gives the entity an import of `source` derived from `externalId`.
 *
 * Re-importing the same backup therefore lands on the same entities instead of creating a
 * second copy, and two devices that each import the same file mint the same rows, which the
 * sync merge folds into one by construction rather than by a duplicate repair.
 */
export const externalImportId = (
  source: string,
  entityType: ExternalImportEntityType,
  externalId: string,
) =>
  deterministicId(ID_NAMESPACES.externalImport, source, entityType, externalId);
