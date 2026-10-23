import type { StoredEntity } from "@/data/storage-adapter";
import type {
  EntityType,
  FinanceEntity,
  TransactionRecord,
} from "@/domain/models";
import { nowIso, updateEntity } from "@/utils/entity";

/** Applies written transaction rows to a list: tombstoned ids drop out, the rest replace by id. */
export function applyTransactionChanges(
  transactions: TransactionRecord[],
  changes: readonly TransactionRecord[],
) {
  const byId = new Map(changes.map((change) => [change.id, change]));
  return transactions
    .filter((transaction) => !byId.get(transaction.id)?.deletedAt)
    .map((transaction) => byId.get(transaction.id) ?? transaction);
}

/** Swaps rows in `list` for the same-id rows in `changes`; an empty `changes` returns `list` as is. */
export function replaceById<T extends { id: string }>(
  list: T[],
  changes: readonly T[],
) {
  if (!changes.length) return list;
  const byId = new Map(changes.map((change) => [change.id, change]));
  return list.map((item) => byId.get(item.id) ?? item);
}

/** Wraps rows as `putMany` records of one entity type. */
export function asRecords(
  type: EntityType,
  rows: readonly FinanceEntity[],
): StoredEntity[] {
  return rows.map((entity) => ({ type, entity }));
}

/** The deleted form of an entity; storage erases it down to its kept fields on write. */
export function tombstone<T extends FinanceEntity>(entity: T) {
  return updateEntity(entity, { deletedAt: nowIso() } as Partial<T>);
}

/** Replaces the row with `entity`'s id, or appends `entity` when the list has none. */
export function withEntity<T extends FinanceEntity>(entities: T[], entity: T) {
  return entities.some((item) => item.id === entity.id)
    ? entities.map((item) => (item.id === entity.id ? entity : item))
    : [...entities, entity];
}

/** The rows that are not tombstones. */
export function active<T extends FinanceEntity>(entities: T[]) {
  return entities.filter((entity) => !entity.deletedAt);
}

export const ENTITY_TYPES: EntityType[] = [
  "accounts",
  "categories",
  "tags",
  "transactions",
  "budgets",
  "budgetPeriods",
  "budgetAdjustments",
  "goals",
  "contributions",
  "recurringRules",
  "exchangeRates",
];

// `ENTITY_TYPES` is the list `hydrateFromStorage` walks, and it deliberately omits the
// settings singleton because that one is read and seeded separately. A merge has no such
// special case — an op can target `settings:settings` like any other row.
export const ALL_ENTITY_TYPES: EntityType[] = ["settings", ...ENTITY_TYPES];

export type ListKey = Exclude<EntityType, "settings">;
