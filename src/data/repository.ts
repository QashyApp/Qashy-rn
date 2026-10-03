import type {
  Account,
  AppSettings,
  Budget,
  BudgetAdjustment,
  BudgetStatus,
  Category,
  CsvImportRow,
  DashboardSummary,
  EntityType,
  ExchangeRate,
  FinanceState,
  ForeignAmountInput,
  Goal,
  GoalContribution,
  ImportResult,
  RecurringRule,
  Tag,
  TransactionFeeInput,
  TransactionQuery,
  TransactionRecord,
} from "@/domain/models";
import type {
  ExternalImportOutcome,
  ImportBundle,
  ImportMode,
} from "@/data/import/types";
import type { CausalMeta, RepairNote, SyncOpBody } from "@/sync/oplog";
import type { DuplicateGroup } from "@/sync/engine/duplicates";

export interface MergeResult {
  /** Records tombstoned because they turned out to be a copy of another one. */
  readonly merged: number;
  /** Records rewritten to point at the survivor instead — the merge's blast radius. */
  readonly retargeted: number;
}

export interface OnboardingInput {
  locale: string;
  baseCurrency: string;
  accountName: string;
  accountType: Account["type"];
  openingBalanceMinor: number;
  /** Optional so callers that predate themes keep working; omitted means the settings' current theme. */
  themeId?: AppSettings["themeId"];
  themeMode: AppSettings["themeMode"];
  accentSource: AppSettings["accentSource"];
  accentHex: string;
}

export type AccountInput = Omit<
  Account,
  "id" | "revision" | "createdAt" | "updatedAt" | "deletedAt"
>;
export type CategoryInput = Omit<
  Category,
  "id" | "revision" | "createdAt" | "updatedAt" | "deletedAt"
>;
export type TagInput = Omit<
  Tag,
  "id" | "revision" | "createdAt" | "updatedAt" | "deletedAt"
>;
export type BudgetInput = Omit<
  Budget,
  "id" | "revision" | "createdAt" | "updatedAt" | "deletedAt"
>;
/** A one-time change to a budget's current period. The date is always today, never chosen. */
export interface BudgetAdjustmentInput {
  budgetId: string;
  /** Signed, non-zero base-currency minor units: positive adds to the limit, negative cuts it. */
  amountMinor: number;
  note: string;
}
export type GoalInput = Omit<
  Goal,
  "id" | "revision" | "createdAt" | "updatedAt" | "deletedAt"
>;
export type ContributionInput = Omit<
  GoalContribution,
  "id" | "revision" | "createdAt" | "updatedAt" | "deletedAt"
>;
export type GoalContributionInput = Omit<ContributionInput, "goalId">;
export type RecurringInput = Omit<
  RecurringRule,
  | "id"
  | "revision"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "pausedByDependency"
>;
export type RateInput = Omit<
  ExchangeRate,
  "id" | "revision" | "createdAt" | "updatedAt" | "deletedAt"
>;
export type SettingsInput = Partial<
  Pick<
    AppSettings,
    | "locale"
    | "baseCurrency"
    | "themeId"
    | "themeMode"
    | "accentSource"
    | "accentHex"
    | "swipeBetweenMonths"
  >
>;

export interface TransactionInput {
  kind: TransactionRecord["kind"];
  status?: TransactionRecord["status"];
  title: string;
  note?: string;
  localDate: string;
  accountId: string;
  destinationAccountId?: string | null;
  categoryId?: string | null;
  tagIds?: string[];
  /** Principal in account currency before fees. Ignored (derived) when `foreign` is set. */
  amountMinor: number;
  destinationAmountMinor?: number | null;
  destinationBaseAmountMinor?: number | null;
  exchangeRate?: string;
  recurringRuleId?: string | null;
  occurrenceKey?: string | null;
  /** Omitted means "none" (null), never "keep existing" — this is a full replacement input. */
  foreign?: ForeignAmountInput | null;
  /** Omitted means "none" (null), never "keep existing" — this is a full replacement input. */
  fee?: TransactionFeeInput | null;
}

export interface FetchedRateConflict {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly effectiveDate: string;
  /** The live rate that blocked this one, so the caller can show what disagreed. */
  readonly existingRate: string;
}

export interface FetchedRateResult {
  /** Rows actually created or updated — an unchanged re-fetch of an already-stored rate is not counted. */
  readonly written: number;
  /** Rows skipped because a manual row already holds this exact (from, to, date) key. */
  readonly skippedManual: number;
  /** Rows skipped because they contradicted an existing reciprocal rate beyond tolerance. */
  readonly conflicts: readonly FetchedRateConflict[];
}

export interface ApplyResult {
  /** Ops folded into the causal state. A batch applies whole or not at all. */
  readonly applied: number;
  /** So the sync engine can coalesce a burst of batches into one hydrate. */
  readonly changedTypes: readonly EntityType[];
  /** What the deterministic repair pass had to fix to make the merged set valid. */
  readonly repairs: readonly RepairNote[];
}

export interface FinanceRepository {
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  applyRemoteOps(ops: readonly SyncOpBody[]): Promise<ApplyResult>;
  applyRemoteState(states: readonly CausalMeta[]): Promise<ApplyResult>;
  /**
   * Recomputes the repair pass over the stored op log, writing only what moved.
   *
   * Repairs are a pure function of the merged set and are re-derived from scratch every pass,
   * which is what lets them *un*-apply: an account resurrected because a merged-in transaction
   * referenced it goes back to tombstoned the moment that transaction does. But a merge only
   * runs when a peer sends something, and the edit that removes a repair's cause is very often
   * local — deleting that transaction on this device. Without this, the device that made the
   * edit keeps the stale repair while every peer that received it drops one, and they disagree
   * until some unrelated batch happens to arrive.
   *
   * Emits no ops and applies none: `applied` is always 0.
   */
  repairProjection(): Promise<ApplyResult>;
  getSnapshot(): FinanceState;
  subscribe(listener: () => void): () => void;
  completeOnboarding(input: OnboardingInput): Promise<void>;
  updateSettings(
    patch: SettingsInput,
    expectedRevision?: number,
  ): Promise<AppSettings>;
  saveAccount(
    input: AccountInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<Account>;
  saveCategory(
    input: CategoryInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<Category>;
  saveTag(
    input: TagInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<Tag>;
  saveTransaction(
    input: TransactionInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<TransactionRecord>;
  saveBudget(
    input: BudgetInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<Budget>;
  /**
   * Adds a one-time adjustment to the budget's *current* period and returns it.
   *
   * Dated today, so it can never land in a closed period — rollover is computed once when a
   * period opens, and a late edit would silently disagree with the number already carried
   * forward. Rejects an adjustment that would push the effective limit below zero.
   */
  addBudgetAdjustment(input: BudgetAdjustmentInput): Promise<BudgetAdjustment>;
  /** Zeroes the rollover carried into a budget's current period, so it starts fresh from its plain limit. */
  resetBudgetRollover(budgetId: string): Promise<void>;
  /** Soft-deletes an adjustment. Only one belonging to a budget's current period can be removed. */
  deleteBudgetAdjustment(id: string): Promise<void>;
  saveGoal(
    input: GoalInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<Goal>;
  saveGoalAndContribution(
    input: GoalInput,
    contribution?: GoalContributionInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<Goal>;
  saveContribution(
    input: ContributionInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<GoalContribution>;
  saveRecurringRule(
    input: RecurringInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<RecurringRule>;
  saveExchangeRate(
    input: RateInput,
    id?: string,
    expectedRevision?: number,
  ): Promise<ExchangeRate>;
  /**
   * Saves a batch of automatically fetched rates in one atomic write.
   *
   * Unlike `saveExchangeRate`, this never throws on a single bad row: a fetched rate that
   * loses to a manual one, that would resurrect a tombstone, or that contradicts a reciprocal
   * rate is skipped and reported rather than failing the whole batch, because one legacy
   * manual row must not block every other currency's automatic refresh. It still throws on
   * invalid input (a bad currency code, date, or rate) — that is a caller bug, not a data
   * conflict — and it still validates the resulting rate set with `assertTransactionSetSafe`
   * before writing anything.
   */
  saveFetchedRates(rates: readonly RateInput[]): Promise<FetchedRateResult>;
  queryTransactions(
    query?: TransactionQuery,
    snapshot?: TransactionRecord[],
  ): TransactionRecord[];
  getDashboard(fromDate: string, toDate: string): DashboardSummary;
  getBudgetStatuses(
    onDate: string,
    options?: { includeInactiveCustom?: boolean },
  ): BudgetStatus[];
  getGoalProgress(goalId: string): number;
  generateRecurring(horizonDate?: string): Promise<number>;
  confirmUpcoming(id: string): Promise<void>;
  skipUpcoming(id: string): Promise<void>;
  updateTransactionsCategory(
    ids: string[],
    categoryId: string | null,
  ): Promise<void>;
  deleteEntities(type: keyof FinanceState, ids: string[]): Promise<void>;
  /**
   * Collapses user-confirmed duplicates into one record each, atomically.
   *
   * Pair two devices that both already hold data and you get two of everything the user
   * created on both. Nothing here is automatic: `suggestDuplicates` proposes the groups, the
   * merge review screen is where they are confirmed, and this applies exactly what was
   * confirmed. Throws — writing nothing — if a group is one the merged vault cannot express,
   * such as two same-named accounts held in different currencies.
   */
  mergeDuplicates(groups: readonly DuplicateGroup[]): Promise<MergeResult>;
  importCsv(rows: CsvImportRow[], commit?: boolean): Promise<ImportResult>;
  /**
   * Imports a bundle parsed from another app's backup, atomically.
   *
   * `commit = false` (the default) is a preview: the whole operation is validated and the
   * outcome reported, but nothing is written and no op is captured. A commit that would leave
   * any item rejected throws before writing, so an import is all or nothing.
   *
   * Every entity id is derived from the bundle's source and external ids, which makes a
   * re-import idempotent. `merge` keeps the vault and reuses same-named entities; `replace`
   * soft-deletes every live entity in the same write that creates the imported ones.
   */
  importExternalBundle(
    bundle: ImportBundle,
    options: { mode: ImportMode },
    commit?: boolean,
  ): Promise<ExternalImportOutcome>;
  exportCsv(): string;
  resetAllData(): Promise<void>;
}
