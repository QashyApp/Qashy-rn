/**
 * What a deleted record keeps.
 *
 * Deleting erases. A tombstone row stays behind only because sync and recurrence need to know
 * that *something* with this id was deleted: without it, another device's copy would sync the
 * record straight back, and a deleted recurring occurrence would be generated again. Everything
 * the user entered — names, notes, titles, amounts, dates, links to other records — is replaced
 * with a blank, so the row says "an item with this id was deleted at this time" and nothing more.
 *
 * Each table below names every field of its entity, and TypeScript requires it to: a field
 * added to a model without an entry here does not compile. A field is kept only when one of
 * these needs it:
 *
 * - **Identity and deletion:** `id`, `revision`, `createdAt`, `updatedAt`, `deletedAt`.
 * - **Recurrence suppression:** a transaction's `occurrenceKey`, which the generator and the
 *   import check before creating an occurrence again.
 * - **Links the sync model pins at create time:** a budget period's `budgetId` and
 *   `periodStart`, an adjustment's `budgetId`, a contribution's `goalId`.
 * - **Shape:** enum kinds and types, so a tombstone still reads as a valid record.
 * - **Account recovery:** an account's `currency`, `icon` and `color`. The sync repair pass
 *   can bring back a deleted account that another device booked a transaction on; it comes back
 *   archived, under a placeholder name, and needs a currency to hold that transaction.
 *
 * Pure and deterministic: the sync merge applies it on every device and must get byte-identical
 * results everywhere.
 */

import type {
  Account,
  Budget,
  BudgetAdjustment,
  BudgetPeriodSnapshot,
  Category,
  EntityType,
  ExchangeRate,
  FinanceEntity,
  Goal,
  GoalContribution,
  RecurringRule,
  SyncEntity,
  Tag,
  TransactionRecord,
} from "@/domain/models";

type Eraser<V> = (value: V) => V;
type ErasureSpec<T> = { readonly [K in keyof T]-?: Eraser<T[K]> };

const keep = <V>(value: V) => value;
const blankText = () => "";
const zero = () => 0;
const nothing = () => null;
const no = () => false;
const none = () => [];
const noFilters = () => ({ accountIds: [], categoryIds: [], tagIds: [] });

const SYNC_ENTITY: ErasureSpec<SyncEntity> = {
  id: keep,
  revision: keep,
  createdAt: keep,
  updatedAt: keep,
  deletedAt: keep,
};

const ACCOUNT: ErasureSpec<Account> = {
  ...SYNC_ENTITY,
  name: blankText,
  type: keep,
  currency: keep,
  openingBalanceMinor: zero,
  icon: keep,
  color: keep,
  archived: no,
};

const CATEGORY: ErasureSpec<Category> = {
  ...SYNC_ENTITY,
  name: blankText,
  kind: keep,
  icon: blankText,
  color: blankText,
  parentId: nothing,
  archived: no,
};

const TAG: ErasureSpec<Tag> = {
  ...SYNC_ENTITY,
  name: blankText,
  color: blankText,
};

const TRANSACTION: ErasureSpec<TransactionRecord> = {
  ...SYNC_ENTITY,
  kind: keep,
  status: keep,
  title: blankText,
  note: blankText,
  localDate: blankText,
  accountId: blankText,
  destinationAccountId: nothing,
  categoryId: nothing,
  tagIds: none,
  amountMinor: zero,
  destinationAmountMinor: nothing,
  destinationBaseAmountMinor: nothing,
  currency: blankText,
  destinationCurrency: nothing,
  exchangeRate: blankText,
  baseAmountMinor: zero,
  transferGroupId: nothing,
  recurringRuleId: nothing,
  occurrenceKey: keep,
  foreign: nothing,
  fee: nothing,
};

const BUDGET: ErasureSpec<Budget> = {
  ...SYNC_ENTITY,
  name: blankText,
  icon: blankText,
  color: blankText,
  limitMinor: zero,
  period: (period) =>
    period && {
      unit: period.unit,
      interval: period.interval,
      anchorDate: "",
      endDate: null,
    },
  rollover: no,
  filters: noFilters,
  categoryLimits: none,
  archived: no,
};

const BUDGET_PERIOD: ErasureSpec<BudgetPeriodSnapshot> = {
  ...SYNC_ENTITY,
  budgetId: keep,
  periodStart: keep,
  periodEnd: blankText,
  limitMinor: zero,
  rolloverMinor: zero,
  filters: noFilters,
  categoryLimits: none,
};

const BUDGET_ADJUSTMENT: ErasureSpec<BudgetAdjustment> = {
  ...SYNC_ENTITY,
  budgetId: keep,
  date: blankText,
  amountMinor: zero,
  note: blankText,
};

const GOAL: ErasureSpec<Goal> = {
  ...SYNC_ENTITY,
  name: blankText,
  kind: keep,
  icon: blankText,
  color: blankText,
  targetMinor: zero,
  initialMinor: zero,
  targetDate: nothing,
  linkedAccountId: nothing,
  linkedCategoryId: nothing,
  archived: no,
};

const CONTRIBUTION: ErasureSpec<GoalContribution> = {
  ...SYNC_ENTITY,
  goalId: keep,
  amountMinor: zero,
  localDate: blankText,
  transactionId: nothing,
  note: blankText,
};

const RECURRING_RULE: ErasureSpec<RecurringRule> = {
  ...SYNC_ENTITY,
  template: (template) =>
    template && {
      kind: template.kind,
      title: "",
      note: "",
      accountId: "",
      categoryId: null,
      tagIds: [],
      amountMinor: 0,
      currency: "",
      foreign: null,
      fee: null,
    },
  unit: keep,
  interval: keep,
  startDate: blankText,
  endDate: nothing,
  nextDueDate: blankText,
  autoPost: no,
  active: no,
  pausedByDependency: no,
};

const EXCHANGE_RATE: ErasureSpec<ExchangeRate> = {
  ...SYNC_ENTITY,
  fromCurrency: blankText,
  toCurrency: blankText,
  rate: blankText,
  effectiveDate: blankText,
};

type AnySpec = Readonly<Record<string, Eraser<unknown>>>;

/**
 * Settings are absent on purpose: the settings record is never deleted, and erasing it would
 * erase the vault's base currency.
 */
const ERASURE: Partial<Record<EntityType, AnySpec>> = {
  accounts: ACCOUNT as unknown as AnySpec,
  categories: CATEGORY as unknown as AnySpec,
  tags: TAG as unknown as AnySpec,
  transactions: TRANSACTION as unknown as AnySpec,
  budgets: BUDGET as unknown as AnySpec,
  budgetPeriods: BUDGET_PERIOD as unknown as AnySpec,
  budgetAdjustments: BUDGET_ADJUSTMENT as unknown as AnySpec,
  goals: GOAL as unknown as AnySpec,
  contributions: CONTRIBUTION as unknown as AnySpec,
  recurringRules: RECURRING_RULE as unknown as AnySpec,
  exchangeRates: EXCHANGE_RATE as unknown as AnySpec,
};

/** True for every type whose tombstones are erased — every type except settings. */
export const isErasable = (type: EntityType) => ERASURE[type] !== undefined;

/**
 * The erased form of one top-level field's value.
 *
 * A field this build does not know is erased too (to `null`): the safe answer for a value
 * whose meaning is unknown is to not keep it.
 */
export function eraseField(
  type: EntityType,
  field: string,
  value: unknown,
): unknown {
  const spec = ERASURE[type];
  if (!spec) return value;
  const erase = spec[field];
  return erase ? erase(value) : null;
}

/**
 * A tombstone with everything but its kept fields erased. A live entity is returned unchanged.
 *
 * Built from the table rather than by blanking the source, so a field the source carries that
 * the table does not list — something from a newer build — is dropped, not kept.
 */
export function eraseEntity<T extends FinanceEntity>(
  type: EntityType,
  entity: T,
): T {
  const spec = ERASURE[type];
  if (!entity.deletedAt || !spec) return entity;
  const source = entity as unknown as Record<string, unknown>;
  const erased: Record<string, unknown> = {};
  for (const [field, erase] of Object.entries(spec))
    erased[field] = erase(source[field]);
  return erased as unknown as T;
}
