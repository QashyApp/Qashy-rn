import {
  budgetTotals,
  computeDashboard,
  computeNetWorthSeries,
  assertDashboardRange,
  assertNetWorthMonths,
  calculateGoalProgress,
} from "@/data/finance/analytics";
import {
  assertBudgetSetSafe,
  assertLimitNotLowered,
  budgetAdjustmentTotal,
  buildBudgetSnapshots,
  computeBudgetStatuses,
  currentSnapshot,
  dueBudgetSnapshots,
  effectiveLimitFor,
} from "@/data/finance/budgets";
import type { FinanceContext } from "@/data/finance/context";
import {
  buildCsvExport,
  buildCsvTransactions,
  stageCsvRows,
} from "@/data/finance/csv";
import {
  applyDeletion,
  deletedOccurrenceKeysOf,
  deletionRecords,
  planEntityDeletion,
} from "@/data/finance/deletion";
import { runExternalImport } from "@/data/finance/import-bundle";
import type { ExternalImportHost } from "@/data/finance/import-bundle-steps";
import { assertMergedSetSafe } from "@/data/finance/merge-safety";
import { queryTransactions } from "@/data/finance/queries";
import {
  normalizeFetchedRates,
  planFetchedRates,
  postedWithSnapshot,
} from "@/data/finance/rates";
import {
  planRecurring,
  planRecurringRuleSave,
  type RecurringDeps,
} from "@/data/finance/recurring";
import {
  ALL_ENTITY_TYPES,
  ENTITY_TYPES,
  active,
  applyTransactionChanges,
  asRecords,
  replaceById,
  tombstone,
  withEntity,
  type ListKey,
} from "@/data/finance/records";
import { assertTransactionSetSafe } from "@/data/finance/safety";
import {
  buildTransaction,
  planCategoryAssignment,
  redatedTransactionInput,
  type BuildTransaction,
} from "@/data/finance/transactions";
import {
  planAccountSave,
  planCategorySave,
  planContributionSave,
  planExchangeRateSave,
  planGoalSave,
} from "@/data/finance/entity-saves";
import { buildSettingsUpdate, planOnboarding } from "@/data/finance/settings";
import {
  assertColor,
  assertDate,
  assertExpectedRevision,
  assertLocale,
  assertNotArchiving,
  assertUniqueName,
  findExisting,
  validateBudget,
} from "@/data/finance/validation";
import type {
  ExternalImportOutcome,
  ImportBundle,
  ImportMode,
} from "@/data/import/types";
import { PlatformStorageAdapter } from "@/data/storage";
import type { StorageAdapter, StoredEntity } from "@/data/storage-adapter";
import { SyncingStorageAdapter } from "@/data/syncing-storage-adapter";
import type {
  Account,
  AppSettings,
  Budget,
  BudgetAdjustment,
  BudgetPeriodSnapshot,
  BudgetStatus,
  Category,
  CsvImportRow,
  DashboardSummary,
  EntityType,
  ExchangeRate,
  FinanceEntity,
  FinanceState,
  Goal,
  GoalContribution,
  RecurringRule,
  Tag,
  TransactionQuery,
  TransactionRecord,
} from "@/domain/models";
import type {
  AccountInput,
  BudgetAdjustmentInput,
  BudgetInput,
  BudgetTotals,
  CategoryInput,
  ContributionInput,
  FetchedRateResult,
  FinanceRepository,
  GoalInput,
  GoalContributionInput,
  NetWorthSeries,
  OnboardingInput,
  RateInput,
  RecurringInput,
  SettingsInput,
  TagInput,
  TransactionInput,
} from "@/data/repository";
import {
  applyOps,
  changedTypes,
  eraseDeletedState,
  finalize,
  isEntityType,
  materialize,
  metaKey,
  mergeMetaMaps,
  repairMergedState,
  type CausalMeta,
  type SyncOpBody,
} from "@/sync/oplog";
import {
  readAllStates,
  readMeta,
  SYNC_META,
  writeMeta,
  writeStates,
} from "@/data/sync-store";
import { eraseEntity } from "@/domain/erasure";
import { planMerge, type DuplicateGroup } from "@/sync/engine/duplicates";
import { DEFAULT_THEME_ID } from "@/theme/themes/types";
import { createInitialState, initialSettings } from "@/domain/defaults";
import { canActivateRecurringRule } from "@/domain/rules";
import { todayLocal } from "@/utils/date";
import { createEntity, makeId, updateEntity } from "@/utils/entity";
import { isSafeMinor, sumMinor, addMinor } from "@/utils/money";

// Part of this module's public surface since before the rules moved to `src/data/finance/`.
export { MissingExchangeRateError } from "@/data/finance/rates";

/**
 * The local-first finance repository: the in-memory snapshot, the storage it persists to, and the
 * queue that serialises every change to both.
 *
 * Mutations come in pairs. The public `foo()` only queues work through `enqueueMutation`, so two
 * mutations never overlap; the private `fooNow()` is the implementation and runs when its turn
 * comes. Validate first, then persist with a single `putMany`, then swap the snapshot and `emit()`.
 *
 * What this class keeps is the stateful core: the snapshot and its derived-read caches, the
 * queue, initialization and refresh, and the sync projection. The finance rules themselves are
 * plain functions in `src/data/finance/`, which read the live snapshot through a `FinanceContext`
 * (or take the slices they need) and never write:
 *
 * - `validation.ts`: field checks, normalizers and the whole-input validators for budgets and goals
 * - `settings.ts` and `entity-saves.ts`: what saving settings, accounts, categories, goals,
 *   contributions and exchange rates writes, planned before anything is persisted
 * - `records.ts`: small helpers over entity lists and `putMany` records
 * - `rates.ts`: exchange-rate lookup, reciprocal checks and the pricing snapshots of unpriced rows
 * - `transactions.ts`: `buildTransaction`, transfer conversion, the CSV duplicate key
 * - `budgets.ts`: period snapshots, rollover, adjustments and budget statuses
 * - `recurring.ts`: schedule walking, generation planning, rule validation and the save plan
 * - `analytics.ts`: the dashboard, the net-worth series and goal progress
 * - `queries.ts`: transaction search and filtering
 * - `safety.ts`: the overflow gate for a local change
 * - `merge-safety.ts`: the pure checks that gate a merged (remote) set
 * - `deletion.ts`: what deleting an entity takes with it
 * - `csv.ts`: CSV row parsing, import staging and export
 * - `import-bundle.ts` (and `import-bundle-steps.ts`): importing another app's backup
 */
export class LocalFinanceRepository implements FinanceRepository {
  private state = createInitialState();
  private listeners = new Set<() => void>();
  /**
   * The device's display locale. Memory only: never persisted, never in `AppSettings`, and it
   * emits no ops. Until `setDisplayLocale` is first called the synced `settings.locale` stands in.
   */
  private displayLocale: string | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private mutationActive = false;
  private pendingExternalRefresh = false;
  /**
   * Whether this instance may write the archived-data sweep. Set by an initialization that
   * generates recurring transactions, or by the explicit `sweepArchived()` step (which covers a
   * memoized headless `initialize`); never by the headless path itself, which stays write-free.
   */
  private sweepsArchived = false;
  private deletedOccurrenceKeys = new Set<string>();
  // Derived reads keyed by the identity of the snapshot arrays they were computed from.
  // Every mutation replaces the arrays it touches, so a stale entry can never be hit.
  private postedCache = new WeakMap<
    TransactionRecord[],
    { all: TransactionRecord[]; ranges: Map<string, TransactionRecord[]> }
  >();
  private transactionIndexCache = new WeakMap<
    TransactionRecord[],
    Map<string, TransactionRecord>
  >();
  private derivedCache: {
    deps: readonly unknown[];
    dashboards: Map<string, DashboardSummary>;
    netWorthSeries: Map<string, NetWorthSeries>;
    budgetStatuses: Map<string, BudgetStatus[]>;
  } | null = null;
  /**
   * What the rules in `src/data/finance/` read: live getters over `state` and `formatLocale`, so a
   * rule sees what `this.state` shows at the moment it reads (including the temporary snapshot
   * `withProspectiveState` swaps in), plus the snapshot caches above.
   */
  private readonly ctx: FinanceContext = Object.defineProperties(
    {} as FinanceContext,
    {
      state: { get: () => this.state },
      formatLocale: { get: () => this.formatLocale },
      postedTransactions: {
        value: (fromDate?: string, toDate?: string) =>
          this.postedTransactions(fromDate, toDate),
      },
      transactionById: {
        value: (transactions: TransactionRecord[]) =>
          this.transactionById(transactions),
      },
    },
  );

  /**
   * `buildTransaction` as the finance rules call it. Always goes through the method, so a rule
   * that builds transactions reaches the one implementation the repository itself uses.
   */
  private readonly build: BuildTransaction = (
    input,
    id,
    additionalTagIds,
    expectedRevision,
    newId,
  ) =>
    this.buildTransaction(input, id, additionalTagIds, expectedRevision, newId);

  /** What recurring generation and validation need beyond the snapshot, read when asked for. */
  private get recurringDeps(): RecurringDeps {
    return {
      buildTransaction: this.build,
      deletedOccurrenceKeys: this.deletedOccurrenceKeys,
    };
  }

  constructor(private storage: StorageAdapter = new PlatformStorageAdapter()) {
    this.storage.subscribe?.((source) => {
      if (source === this || !this.state.ready) return;
      if (this.mutationActive) {
        // A refresh cannot run while a mutation holds the queue, but dropping it
        // left this window permanently stale: later local writes rebuild from the
        // stale snapshot, so nothing self-healed until the tab regained focus.
        // Remember it instead and drain once the queue settles.
        this.pendingExternalRefresh = true;
        return;
      }
      // Mirror `drainExternalRefresh`: a failed reload must not be dropped, or the
      // tab keeps rendering a snapshot it already knows is out of date. Re-arm so
      // the next settled mutation retries.
      this.refresh().catch(() => {
        this.pendingExternalRefresh = true;
      });
    });
  }

  private initialization: Promise<void> | null = null;

  /**
   * Idempotent: a call while initialization is in flight or finished returns the same promise,
   * whatever its options. A failed attempt is forgotten so the retry button can run it again.
   * `generateRecurring: false` is for a headless read-only refresh (a widget), which must never
   * post transactions; the app's own startup still generates through the provider's explicit
   * `generateRecurring()` after `initialize()`. Only an initialization that generates also sweeps
   * archived data (before generating, before `ready`); the headless path neither sweeps nor
   * generates. Because this is memoized, the provider also calls `sweepArchived()` explicitly, which
   * covers a headless call having run first in the process.
   */
  initialize(options: { generateRecurring?: boolean } = {}) {
    if (this.initialization) return this.initialization;
    const attempt = this.enqueueMutation(() =>
      this.initializeNow(options.generateRecurring ?? true),
    );
    this.initialization = attempt;
    attempt.catch(() => {
      if (this.initialization === attempt) this.initialization = null;
    });
    return attempt;
  }

  private async initializeNow(generateRecurring: boolean) {
    await this.storage.initialize();
    await this.eraseStoredTombstones();
    await this.hydrateFromStorage();
    // No placeholder settings row is written here, and that is load-bearing for sync.
    //
    // `baseCurrency` is `createOnly` in the merge registry — deliberately, because rebasing
    // every snapshotted `baseAmountMinor` is not something a merge can do. So whatever value
    // the settings entity's *create* op carries is the value every peer materializes, forever.
    // Seeding a row before onboarding meant that op carried the app default, onboarding's real
    // choice arrived as a `set` the diff correctly dropped, and a vault set up in ILS shipped a
    // log that said USD. `records` and the op log disagreed permanently, and the disagreement
    // resolved in favour of the log the first time anything re-projected.
    //
    // Deferring the first write to `completeOnboarding` makes that write the create, so the op
    // log states the real base currency from the start. An un-onboarded store rehydrates to
    // exactly `createInitialState()`, so nothing else depends on the row being there early.
    if (generateRecurring) {
      this.sweepsArchived = true;
      // Before generation, so a schedule the sweep is about to delete does not post first.
      await this.sweepArchivedNow();
      await this.migrateSwipeDefaultNow();
      await this.generateRecurringNow(todayLocal());
    }
    // Only now is the snapshot complete enough for screens to render against.
    this.state = { ...this.state, ready: true };
    this.emit();
  }

  /**
   * Erases, once per device, the tombstones stored before deleting erased them.
   *
   * Both halves: the rows in `records`, and the causal state sync keeps for them. Through
   * `transact`, never `putMany`, because this is not an edit — it rewrites rows into the form
   * every tombstone is now written in, and must emit no ops. Ops already in the log keep what
   * they carried until compaction drops them, as it does every op.
   */
  private async eraseStoredTombstones() {
    await this.storage.transact(
      async (tx) => {
        const done = await readMeta(tx, [SYNC_META.tombstonesErased]);
        if (done.get(SYNC_META.tombstonesErased) === "1") return;

        const records: StoredEntity[] = [];
        for (const type of ALL_ENTITY_TYPES) {
          for (const entity of await tx.readAll(type)) {
            if (!entity.deletedAt) continue;
            const erased = eraseEntity(type, entity);
            if (JSON.stringify(erased) !== JSON.stringify(entity))
              records.push({ type, entity: erased });
          }
        }
        if (records.length) await tx.putMany(records);

        const states: CausalMeta[] = [];
        for (const meta of (await readAllStates(tx)).values()) {
          const erased = eraseDeletedState(meta);
          if (erased !== meta) states.push(erased);
        }
        await writeStates(tx, states);
        await writeMeta(tx, { [SYNC_META.tombstonesErased]: "1" });
      },
      { silent: true },
    );
  }

  refresh() {
    return this.enqueueMutation(async () => {
      await this.hydrateFromStorage();
      this.emit();
      // Records another tab or an older build wrote may still be archived.
      await this.sweepArchivedNow();
    });
  }

  /**
   * Enables the archived-data sweep for this process and runs one (idempotent). The app's own
   * startup calls it after `initialize()` and before `generateRecurring()`, since `initialize` is
   * memoized and a headless call may have won; a headless read-only refresh never calls it. From then on a refresh or a merge also sweeps.
   * See `sweepArchivedNow` for what it does.
   */
  sweepArchived() {
    return this.enqueueMutation(async () => {
      this.sweepsArchived = true;
      if (this.state.ready) {
        await this.sweepArchivedNow();
        await this.migrateSwipeDefaultNow();
      }
    });
  }

  /**
   * Turns month swiping on, once per device, for installs that stored it off back when off was
   * the default. Guarded by `SYNC_META.swipeDefaultMigrated`, which is marked only after the write
   * succeeds, so a failure retries next launch and a user who later turns swiping off keeps it off.
   *
   * Foreground only, like the archived sweep (`sweepsArchived` is that same gate): the headless
   * widget refresh and background sync must stay write-free. It goes through the ordinary settings
   * update, so the snapshot and subscribers stay consistent; the field is device-local, so no op
   * is emitted. Before onboarding there is no settings row to update (and writing a placeholder
   * one would pin the wrong base currency, see `initializeNow`); a new row defaults to on, so the
   * flag is simply marked. Like the sweep, a failure is left for the next launch and never blocks
   * startup.
   */
  private async migrateSwipeDefaultNow() {
    if (!this.sweepsArchived) return;
    try {
      const done = await this.storage.transact(
        (tx) => readMeta(tx, [SYNC_META.swipeDefaultMigrated]),
        { silent: true },
      );
      if (done.get(SYNC_META.swipeDefaultMigrated) === "1") return;
      const { settings } = this.state;
      if (settings.onboardingComplete && settings.swipeBetweenMonths !== true)
        await this.updateSettingsNow({ swipeBetweenMonths: true });
      await this.storage.transact(
        (tx) => writeMeta(tx, { [SYNC_META.swipeDefaultMigrated]: "1" }),
        { silent: true },
      );
    } catch {
      // Retried on the next launch; the app works either way.
    }
  }

  /**
   * Deletes, for real, what an earlier version archived. Nothing is archived any more: deleting
   * erases. Runs after `sweepArchived()` (never in a headless read-only refresh) and, once
   * enabled, after a refresh or a merge brings records in, since an older peer can still send
   * `archived: true`.
   *
   * Idempotent and deterministic: it reads only the snapshot, orders by creation time and id, and
   * writes nothing once nothing is archived, so two devices sweeping the same data reach the same
   * result. Archived budgets and goals are deleted like any other; archived accounts and
   * categories go through the ordinary delete rules, except that a schedule paused because of an
   * archived category stays paused (it only becomes uncategorized), and the last account is
   * un-archived rather than deleted. Not part of the sync repair pass, which must stay pure.
   *
   * A failure is left for the next launch or refresh to retry rather than blocking startup.
   */
  private async sweepArchivedNow() {
    if (!this.sweepsArchived) return;
    const archivedIds = (
      list: readonly (FinanceEntity & { archived: boolean })[],
    ) => list.filter((item) => item.archived).map((item) => item.id);
    const steps: (() => Promise<void>)[] = [
      async () => {
        const ids = archivedIds(this.state.budgets);
        if (ids.length)
          await this.deleteEntitiesNow("budgets", ids, { sweep: true });
      },
      async () => {
        const ids = archivedIds(this.state.goals);
        if (ids.length)
          await this.deleteEntitiesNow("goals", ids, { sweep: true });
      },
      async () => {
        const archived = this.state.accounts
          .filter((account) => account.archived)
          .sort(
            (first, second) =>
              (first.createdAt < second.createdAt
                ? -1
                : first.createdAt > second.createdAt
                  ? 1
                  : 0) ||
              (first.id < second.id ? -1 : first.id > second.id ? 1 : 0),
          );
        if (!archived.length) return;
        let doomed = archived;
        if (!this.state.accounts.some((account) => !account.archived)) {
          // Deleting them all would leave no account. The oldest stays, as an ordinary account;
          // its paused schedules stay paused.
          const [keep, ...rest] = archived;
          const released = this.state.recurringRules
            .filter(
              (rule) =>
                rule.pausedByDependency && rule.template.accountId === keep.id,
            )
            .map((rule) => updateEntity(rule, { pausedByDependency: false }));
          const revived = updateEntity(keep, { archived: false });
          await this.storage.putMany(
            [
              ...asRecords("accounts", [revived]),
              ...asRecords("recurringRules", released),
            ],
            this,
          );
          this.state = {
            ...this.state,
            accounts: replaceById(this.state.accounts, [revived]),
            recurringRules: replaceById(this.state.recurringRules, released),
          };
          this.emit();
          doomed = rest;
        }
        if (doomed.length)
          await this.deleteEntitiesNow(
            "accounts",
            doomed.map((account) => account.id),
            { sweep: true },
          );
      },
      async () => {
        const ids = archivedIds(this.state.categories);
        if (ids.length)
          await this.deleteEntitiesNow("categories", ids, { sweep: true });
      },
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (reason) {
        // Anything at all, a malformed row included: the sweep must never block startup or a
        // merge. A fixed message and an error name only, since the text can carry finance
        // data. The next launch or refresh retries.
        console.warn(
          `[archive-sweep] Step failed (${reason instanceof Error ? reason.name : "unknown"})`,
        );
      }
    }
  }

  getSnapshot = () => this.state;

  /**
   * The locale used for parsing and formatting inside repository rules. The pre-provider fallback
   * is safe: every consumer only feeds `currencyDigits` (pinned per currency) and invariant
   * parsing, so no persisted value or op output depends on which locale is in effect.
   */
  private get formatLocale(): string {
    return this.displayLocale ?? this.state.settings.locale;
  }

  setDisplayLocale(locale: string): void {
    assertLocale(locale);
    const changed = locale !== this.formatLocale;
    this.displayLocale = locale;
    if (changed) this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Folds a batch of ops from another device into local state.
   *
   * Routed through the mutation queue rather than written straight to storage, and that is
   * not tidiness — it closes a lost-update window. Every local save hands `putMany` a *whole
   * entity* built from `this.state`, not a patch. If a merge committed between a save
   * reading `this.state` and its `await storage.putMany(...)`, the save would write back its
   * pre-merge view and silently revert the remote change on every field the two disagree
   * about. Serialising remote applies through the same queue removes the interleaving.
   *
   * The batch applies whole or not at all: the merged set is repaired and checked before
   * anything is written, and a failure leaves both `records` and the causal state untouched.
   */
  applyRemoteOps(ops: readonly SyncOpBody[]) {
    return this.enqueueMutation(async () => {
      // An op naming an entity type this version does not know comes from a newer app. The
      // sync engine still stores and forwards it — dropping it would break the hash chain for
      // every peer downstream — but there is nothing here to project it onto.
      const known = ops.filter((op) => isEntityType(op.entityType));
      if (!known.length) return { applied: 0, changedTypes: [], repairs: [] };
      const { repairs } = await this.projectNow(known);
      await this.sweepArchivedNow();
      return {
        applied: known.length,
        changedTypes: changedTypes(known),
        repairs,
      };
    });
  }

  applyRemoteState(states: readonly CausalMeta[]) {
    return this.enqueueMutation(async () => {
      const { writtenTypes, repairs } = await this.projectNow(
        [],
        new Map(
          states.map((state) => [
            metaKey(state.entityType, state.entityId),
            state,
          ]),
        ),
      );
      await this.sweepArchivedNow();
      return { applied: states.length, changedTypes: writtenTypes, repairs };
    });
  }

  /**
   * Re-runs the repair sweep over the stored op log without applying anything new.
   *
   * See the contract in `repository.ts` for why this exists at all: a *local* edit can remove
   * the reason a repair was firing, and nothing else on this device would ever notice.
   */
  repairProjection() {
    return this.enqueueMutation(async () => {
      const { writtenTypes, repairs } = await this.projectNow([]);
      await this.sweepArchivedNow();
      return { applied: 0, changedTypes: writtenTypes, repairs };
    });
  }

  private async projectNow(
    known: readonly SyncOpBody[],
    remoteStates?: ReadonlyMap<string, CausalMeta>,
  ) {
    // One transaction, and every read inside it. `transact`, deliberately, not `putMany`:
    // once `SyncingStorageAdapter` is installed, `putMany` is the change-capturing path and
    // would diff this merged result against the rows it replaces, emitting *local* ops that
    // attribute a peer's change to this device — which then replicate back as though this
    // device had made them. `transact` is the pass-through, and this is one of the callers
    // it exists for. `this` as the source so the adapter's own notification is filtered out
    // and the hydrate below is the only one; another tab sees a foreign write and takes the
    // existing `pendingExternalRefresh` path.
    const { written, writtenTypes, repairs } = await this.storage.transact(
      async (tx) => {
        // `sync_state` is the authority for causal state, re-read per pass rather than cached
        // in a field. A *local* write advances it through `SyncingStorageAdapter`, which this
        // object never observes, so a cached copy goes stale for precisely the fields both
        // devices touched — and a register missing from a stale copy has no HLC to lose to,
        // silently handing an older remote op the win over a newer local edit.
        const keys = remoteStates
          ? [...remoteStates.keys()]
          : [
              ...new Set(
                known.map((op) => metaKey(op.entityType, op.entityId)),
              ),
            ];
        const localStates = await readAllStates(tx);
        const merged = remoteStates
          ? mergeMetaMaps(localStates, remoteStates)
          : applyOps(localStates, known);

        // Read through storage rather than `this.state`: the snapshot drops tombstones, and
        // the repair pass has to see them. Resurrecting an account that a merged-in
        // transaction references is impossible if the deleted row is invisible.
        const original = new Map<string, FinanceEntity>();
        const tables = new Map<EntityType, Map<string, FinanceEntity>>();
        for (const type of ALL_ENTITY_TYPES) {
          const table = new Map<string, FinanceEntity>();
          for (const entity of await tx.readAll(type)) {
            table.set(entity.id, entity);
            original.set(metaKey(type, entity.id), entity);
          }
          tables.set(type, table);
        }

        // Every entity, not just the ones this batch names — and that is the whole reason the
        // full causal state is read above. The repair pass writes its corrections into
        // `records`, so feeding it `records` back would feed it its own output: an account
        // resurrected last week reads as live, the pass sees nothing to fix, and it stays live
        // forever even after the transaction that needed it is gone. Re-projecting from the op
        // log every pass is what makes a repair a *view* of the merged history rather than an
        // edit to it — recomputed from scratch, and therefore able to un-apply.
        for (const meta of merged.values()) {
          const table = tables.get(meta.entityType);
          if (!table) continue;
          // `materialize` returns null until the entity's `create` op has landed. A set that
          // arrives before its create is held rather than projected into a half-formed row.
          const next = materialize(meta, table.get(meta.entityId) ?? null);
          if (next) table.set(meta.entityId, next);
        }

        const list = <T extends FinanceEntity>(type: EntityType) =>
          [...tables.get(type)!.values()] as T[];
        const repaired = repairMergedState({
          settings:
            (tables.get("settings")!.get("settings") as
              AppSettings | undefined) ?? null,
          accounts: list<Account>("accounts"),
          categories: list<Category>("categories"),
          tags: list<Tag>("tags"),
          transactions: list<TransactionRecord>("transactions"),
          budgets: list<Budget>("budgets"),
          budgetPeriods: list<BudgetPeriodSnapshot>("budgetPeriods"),
          budgetAdjustments: list<BudgetAdjustment>("budgetAdjustments"),
          goals: list<Goal>("goals"),
          contributions: list<GoalContribution>("contributions"),
          recurringRules: list<RecurringRule>("recurringRules"),
          exchangeRates: list<ExchangeRate>("exchangeRates"),
        });
        assertMergedSetSafe(repaired, this.formatLocale);

        const records: StoredEntity[] = [];
        const touched = new Set<EntityType>();
        const push = (type: EntityType, entities: readonly FinanceEntity[]) => {
          for (const entity of entities) {
            // `finalize` settles `revision` against what is actually stored, and reports the
            // record unchanged when only the derived fields moved — so an op that re-states
            // a value this device already holds writes nothing and bumps nothing. Compared in
            // erased form because that is how a tombstone is stored: a duplicate the repair
            // pass tombstones would otherwise differ from its stored self on every merge.
            const { entity: settled, changed } = finalize(
              eraseEntity(type, entity),
              original.get(metaKey(type, entity.id)) ?? null,
            );
            if (!changed) continue;
            records.push({ type, entity: settled });
            touched.add(type);
          }
        };
        for (const type of ALL_ENTITY_TYPES) {
          push(
            type,
            type === "settings"
              ? repaired.settings
                ? [repaired.settings]
                : []
              : repaired[type],
          );
        }

        if (records.length) await tx.putMany(records);
        // Unconditional, and in the same transaction as the records. A record written
        // without its causal state would be re-derived from a merge that has already moved
        // on; a causal state written without its record would leave the projection behind a
        // merge this device has already agreed to. And a batch that changes no record still
        // advances the state — that is what makes redelivery a no-op rather than a re-merge.
        await writeStates(
          tx,
          remoteStates
            ? [...merged.values()]
            : keys.map((key) => merged.get(key)!),
        );
        return {
          written: records.length,
          writtenTypes: [...touched],
          repairs: repaired.notes,
        };
      },
      { source: this },
    );

    if (written) {
      await this.hydrateFromStorage();
      this.emit();
    }
    return { written, writtenTypes, repairs };
  }

  completeOnboarding(input: OnboardingInput) {
    return this.enqueueMutation(() => this.completeOnboardingNow(input));
  }

  private async completeOnboardingNow(input: OnboardingInput) {
    const { settings, account, categories } = planOnboarding(this.ctx, input);

    await this.storage.putMany(
      [
        { type: "settings", entity: settings },
        { type: "accounts", entity: account },
        ...asRecords("categories", categories),
      ],
      this,
    );
    this.state = { ...this.state, settings, accounts: [account], categories };
    this.emit();
  }

  updateSettings(patch: SettingsInput, expectedRevision?: number) {
    return this.enqueueMutation(() =>
      this.updateSettingsNow(patch, expectedRevision),
    );
  }

  private async updateSettingsNow(
    patch: SettingsInput,
    expectedRevision?: number,
  ) {
    const settings = buildSettingsUpdate(
      this.state.settings,
      patch,
      expectedRevision,
    );

    await this.persist("settings", [settings]);
    this.state = { ...this.state, settings };
    this.emit();
    return settings;
  }

  saveAccount(input: AccountInput, id?: string, expectedRevision?: number) {
    return this.enqueueMutation(() =>
      this.saveAccountNow(input, id, expectedRevision),
    );
  }

  private async saveAccountNow(
    input: AccountInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const { account, existing, accounts } = planAccountSave(
      this.ctx,
      input,
      id,
      expectedRevision,
    );

    await this.commitWithDependentRules(
      "accounts",
      account,
      !!existing?.archived && !input.archived,
      (rule) => rule.template.accountId === account.id,
      (rule) => canActivateRecurringRule(rule, accounts, this.state.categories),
    );
    return account;
  }

  /**
   * Writes an account or category together with the recurring rules it had paused (only the rules
   * paused by this dependency that can run again), when saving it un-archives a record an older
   * build archived.
   */
  private async commitWithDependentRules(
    type: "accounts" | "categories",
    entity: Account | Category,
    wasArchived: boolean,
    dependsOn: (rule: RecurringRule) => boolean,
    canResume: (rule: RecurringRule) => boolean,
  ) {
    const rules = wasArchived
      ? this.state.recurringRules
          .filter(
            (rule) =>
              !rule.active &&
              rule.pausedByDependency &&
              dependsOn(rule) &&
              canResume(rule),
          )
          .map((rule) =>
            updateEntity(rule, { active: true, pausedByDependency: false }),
          )
      : [];
    await this.storage.putMany(
      [
        { type, entity } as StoredEntity,
        ...rules.map((rule) => ({
          type: "recurringRules" as const,
          entity: rule,
        })),
      ],
      this,
    );
    this.replaceInList(type, entity);
    rules.forEach((rule) => this.replaceInList("recurringRules", rule));
    this.emit();
    if (rules.some((rule) => rule.active)) {
      await this.generateAfterCommit();
    }
  }

  saveCategory(input: CategoryInput, id?: string, expectedRevision?: number) {
    return this.enqueueMutation(() =>
      this.saveCategoryNow(input, id, expectedRevision),
    );
  }

  private async saveCategoryNow(
    input: CategoryInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const { category, existing, categories } = planCategorySave(
      this.ctx,
      input,
      id,
      expectedRevision,
    );

    await this.commitWithDependentRules(
      "categories",
      category,
      !!existing?.archived && !input.archived,
      (rule) => rule.template.categoryId === category.id,
      (rule) => canActivateRecurringRule(rule, this.state.accounts, categories),
    );
    return category;
  }

  saveTag(input: TagInput, id?: string, expectedRevision?: number) {
    return this.enqueueMutation(() =>
      this.saveTagNow(input, id, expectedRevision),
    );
  }

  private async saveTagNow(
    input: TagInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const name = input.name.trim();
    if (!name) throw new Error("Tag name is required.");
    assertUniqueName(this.ctx, "tags", name, id);
    assertColor(input.color);
    return await this.saveListEntity<Tag>(
      "tags",
      { ...input, name, color: input.color.toUpperCase() },
      id,
      expectedRevision,
    );
  }

  saveTransaction(
    input: TransactionInput,
    id?: string,
    expectedRevision?: number,
  ) {
    return this.enqueueMutation(() =>
      this.saveTransactionNow(input, id, expectedRevision),
    );
  }

  private async saveTransactionNow(
    input: TransactionInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const transaction = this.buildTransaction(input, id, [], expectedRevision);
    assertTransactionSetSafe(
      this.ctx,
      withEntity(this.state.transactions, transaction),
    );
    await this.commitOne("transactions", transaction);
    return transaction;
  }

  saveBudget(input: BudgetInput, id?: string, expectedRevision?: number) {
    return this.enqueueMutation(() =>
      this.saveBudgetNow(input, id, expectedRevision),
    );
  }

  private async saveBudgetNow(
    input: BudgetInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const normalized = validateBudget(this.ctx, input);
    const existing = findExisting(this.state.budgets, id, "budget");
    assertNotArchiving(input.archived, existing?.archived);
    assertExpectedRevision(existing, input, expectedRevision);
    const budget = existing
      ? updateEntity(existing, normalized)
      : (createEntity({ id: makeId(), ...normalized }) as Budget);
    assertBudgetSetSafe(withEntity(this.state.budgets, budget));
    const periods = buildBudgetSnapshots(
      this.ctx,
      budget,
      true,
      todayLocal(),
      false,
      // Turning rollover on partway through a period brings the previous period's carry in.
      Boolean(existing && !existing.rollover && budget.rollover),
    );
    // Throws if any period's effective limit would leave the safe-integer range.
    periods.forEach((period) => effectiveLimitFor(this.ctx, budget, period));
    await this.storage.putMany(
      [
        { type: "budgets", entity: budget },
        ...asRecords("budgetPeriods", periods),
      ],
      this,
    );
    this.replaceInList("budgets", budget);
    periods.forEach((period) => this.replaceInList("budgetPeriods", period));
    this.emit();
    return budget;
  }

  addBudgetAdjustment(input: BudgetAdjustmentInput) {
    return this.enqueueMutation(() => this.addBudgetAdjustmentNow(input));
  }

  private async addBudgetAdjustmentNow(input: BudgetAdjustmentInput) {
    const budget = active(this.state.budgets).find(
      (item) => item.id === input.budgetId,
    );
    if (!budget || budget.archived) throw new Error("Choose a valid budget.");
    if (!isSafeMinor(input.amountMinor) || input.amountMinor === 0) {
      throw new Error("Adjustment must be a non-zero amount.");
    }
    // Always today: a closed period's rollover is already baked into the next one, so an
    // adjustment dated into it would silently disagree with the number carried forward.
    const today = todayLocal();
    const snapshot = currentSnapshot(this.ctx, budget, today);
    if (!snapshot)
      throw new Error("This budget has no active period to adjust.");
    const before = effectiveLimitFor(this.ctx, budget, snapshot);
    const adjustment = createEntity({
      id: makeId(),
      budgetId: budget.id,
      date: today,
      amountMinor: input.amountMinor,
      note: input.note.trim(),
    }) as BudgetAdjustment;
    // The whole-vault total is checked too, not just this budget: the dashboard sums every
    // effective limit and would throw on read if this pushed the sum past a safe integer.
    this.withProspectiveState(
      {
        budgetAdjustments: [...this.state.budgetAdjustments, adjustment],
      },
      () => {
        const statuses = this.getBudgetStatuses(today, {
          includeInactiveCustom: true,
        });
        sumMinor(
          statuses.map((entry) => entry.effectiveLimitMinor),
          "Budget limit total",
        );
        const after = effectiveLimitFor(this.ctx, budget, snapshot);
        assertLimitNotLowered(before, after, "This adjustment");
      },
    );
    await this.commitOne("budgetAdjustments", adjustment);
    return adjustment;
  }

  resetBudgetRollover(budgetId: string) {
    return this.enqueueMutation(() => this.resetBudgetRolloverNow(budgetId));
  }

  private async resetBudgetRolloverNow(budgetId: string) {
    const budget = active(this.state.budgets).find(
      (item) => item.id === budgetId,
    );
    if (!budget || budget.archived) throw new Error("Choose a valid budget.");
    // The same lookup adjustments use: a period that rolled over while the app stayed open has
    // no stored row yet, and resetting it must still count rather than be silently dropped.
    const snapshot = currentSnapshot(this.ctx, budget, todayLocal());
    if (!snapshot)
      throw new Error("This budget has no active period to reset.");
    if (snapshot.rolloverMinor === 0) return;
    // Zeroing the rollover must not cut the limit below zero, exactly like removing an adjustment.
    const before = effectiveLimitFor(this.ctx, budget, snapshot);
    const after = addMinor(
      snapshot.limitMinor,
      budgetAdjustmentTotal(
        this.ctx,
        budget.id,
        snapshot.periodStart,
        snapshot.periodEnd,
      ),
      `${budget.name} effective limit`,
    );
    assertLimitNotLowered(before, after, "Resetting the rollover");
    // Updating a transient snapshot persists it, which is what the next generation pass would do.
    const reset = updateEntity(snapshot, { rolloverMinor: 0 });
    await this.commitOne("budgetPeriods", reset);
  }

  deleteBudgetAdjustment(id: string) {
    return this.enqueueMutation(() => this.deleteBudgetAdjustmentNow(id));
  }

  private async deleteBudgetAdjustmentNow(id: string) {
    const adjustment = this.state.budgetAdjustments.find(
      (item) => item.id === id,
    );
    if (!adjustment) throw new Error("Choose a valid budget adjustment.");
    const budget = active(this.state.budgets).find(
      (item) => item.id === adjustment.budgetId,
    );
    const snapshot = budget
      ? currentSnapshot(this.ctx, budget, todayLocal())
      : undefined;
    if (
      !budget ||
      !snapshot ||
      adjustment.date < snapshot.periodStart ||
      adjustment.date > snapshot.periodEnd
    ) {
      throw new Error(
        "Only adjustments from the current period can be removed.",
      );
    }
    const before = effectiveLimitFor(this.ctx, budget, snapshot);
    const remaining = this.state.budgetAdjustments.filter(
      (item) => item.id !== id,
    );
    this.withProspectiveState({ budgetAdjustments: remaining }, () => {
      assertLimitNotLowered(
        before,
        effectiveLimitFor(this.ctx, budget, snapshot),
        "Removing this adjustment",
      );
    });
    const retired = tombstone(adjustment);
    await this.persist("budgetAdjustments", [retired]);
    this.state = { ...this.state, budgetAdjustments: remaining };
    this.emit();
  }

  saveGoal(input: GoalInput, id?: string, expectedRevision?: number) {
    return this.enqueueMutation(() =>
      this.saveGoalAndContributionNow(input, undefined, id, expectedRevision),
    );
  }

  saveGoalAndContribution(
    input: GoalInput,
    contribution?: GoalContributionInput,
    id?: string,
    expectedRevision?: number,
    editContribution?: { id: string; expectedRevision?: number },
  ) {
    return this.enqueueMutation(() =>
      this.saveGoalAndContributionNow(
        input,
        contribution,
        id,
        expectedRevision,
        editContribution,
      ),
    );
  }

  private async saveGoalAndContributionNow(
    input: GoalInput,
    contribution?: GoalContributionInput,
    id?: string,
    expectedRevision?: number,
    editContribution?: { id: string; expectedRevision?: number },
  ) {
    const { goal, contributionEntity } = planGoalSave(
      this.ctx,
      input,
      contribution,
      id,
      expectedRevision,
      editContribution,
    );

    await this.storage.putMany(
      [
        { type: "goals", entity: goal },
        ...(contributionEntity
          ? [{ type: "contributions" as const, entity: contributionEntity }]
          : []),
      ],
      this,
    );
    // Re-derive from the post-await snapshot rather than reusing the `goals` /
    // `contributions` copies taken before the write. Another mutation can land
    // while the persist is in flight, and rebuilding from the stale copy drops
    // it from the in-memory state while it stays on disk — the UI then shows a
    // goal total that disagrees with the database until the next reload.
    this.state = {
      ...this.state,
      goals: withEntity(this.state.goals, goal),
      contributions: contributionEntity
        ? withEntity(this.state.contributions, contributionEntity)
        : this.state.contributions,
    };
    this.emit();
    return goal;
  }

  saveContribution(
    input: ContributionInput,
    id?: string,
    expectedRevision?: number,
  ) {
    return this.enqueueMutation(() =>
      this.saveContributionNow(input, id, expectedRevision),
    );
  }

  private async saveContributionNow(
    input: ContributionInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const contribution = planContributionSave(
      this.ctx,
      input,
      id,
      expectedRevision,
    );

    await this.commitOne("contributions", contribution);
    return contribution;
  }

  saveRecurringRule(
    input: RecurringInput,
    id?: string,
    expectedRevision?: number,
  ) {
    return this.enqueueMutation(() =>
      this.saveRecurringRuleNow(input, id, expectedRevision),
    );
  }

  private async saveRecurringRuleNow(
    input: RecurringInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const { rule, transactionChanges } = planRecurringRuleSave(
      this.ctx,
      this.recurringDeps,
      input,
      id,
      expectedRevision,
    );

    await this.storage.putMany(
      [
        { type: "recurringRules", entity: rule },
        ...asRecords("transactions", transactionChanges),
      ],
      this,
    );
    this.state = {
      ...this.state,
      recurringRules: withEntity(this.state.recurringRules, rule),
      transactions: applyTransactionChanges(
        this.state.transactions,
        transactionChanges,
      ),
    };
    this.emit();
    if (rule.active) await this.generateAfterCommit();
    return rule;
  }

  saveExchangeRate(input: RateInput, id?: string, expectedRevision?: number) {
    return this.enqueueMutation(() =>
      this.saveExchangeRateNow(input, id, expectedRevision),
    );
  }

  private async saveExchangeRateNow(
    input: RateInput,
    id?: string,
    expectedRevision?: number,
  ) {
    const exchangeRate = planExchangeRateSave(
      this.ctx,
      input,
      id,
      expectedRevision,
    );

    await this.commitOne("exchangeRates", exchangeRate);
    return exchangeRate;
  }

  saveFetchedRates(rates: readonly RateInput[]) {
    return this.enqueueMutation(() => this.saveFetchedRatesNow(rates));
  }

  private async saveFetchedRatesNow(
    rates: readonly RateInput[],
  ): Promise<FetchedRateResult> {
    const normalized = normalizeFetchedRates(this.ctx, rates);

    // `this.state.exchangeRates` drops tombstones (see `hydrateFromStorage`), so a row this
    // device deleted is simply absent from it — indistinguishable from a row that never
    // existed. Reading storage directly is what lets "never resurrect a deleted fetched rate"
    // tell those two apart.
    const stored = (await this.storage.readAll(
      "exchangeRates",
    )) as ExchangeRate[];
    const storedById = new Map(stored.map((item) => [item.id, item]));

    const { exchangeRates, written, conflicts, skippedManual } =
      planFetchedRates(this.ctx, normalized, storedById);

    if (!written.length) return { written: 0, skippedManual, conflicts };

    assertTransactionSetSafe(
      this.ctx,
      this.state.transactions,
      this.state.accounts,
      exchangeRates,
    );
    await this.persist("exchangeRates", written);
    this.state = { ...this.state, exchangeRates };
    this.emit();
    return { written: written.length, skippedManual, conflicts };
  }

  queryTransactions(
    query: TransactionQuery = {},
    snapshot = this.state.transactions,
  ) {
    return queryTransactions(this.ctx, query, snapshot);
  }

  getDashboard(
    fromDate: string,
    toDate: string,
    options: { includePendingAutoPosts?: boolean } = {},
  ): DashboardSummary {
    if (options.includePendingAutoPosts) {
      assertDate(toDate);
      return this.withPendingRecurring(true, toDate, () =>
        this.getDashboard(fromDate, toDate),
      );
    }
    assertDashboardRange(fromDate, toDate);
    const derived = this.derived();
    const dashboardKey = `${fromDate}|${toDate}`;
    const cachedDashboard = derived.dashboards.get(dashboardKey);
    if (cachedDashboard) return cachedDashboard;
    const summary = computeDashboard(
      this.ctx,
      fromDate,
      toDate,
      (onDate, budgetOptions) => this.getBudgetStatuses(onDate, budgetOptions),
    );
    derived.dashboards.set(dashboardKey, summary);
    return summary;
  }

  getBudgetTotals(
    fromDate: string,
    toDate: string,
    options: { includePendingAutoPosts?: boolean } = {},
  ): BudgetTotals {
    if (options.includePendingAutoPosts) {
      assertDate(toDate);
      return this.withPendingRecurring(true, toDate, () =>
        this.getBudgetTotals(fromDate, toDate),
      );
    }
    assertDashboardRange(fromDate, toDate);
    const cached = this.derived().dashboards.get(`${fromDate}|${toDate}`);
    if (cached) {
      return {
        budgetLimitMinor: cached.budgetLimitMinor,
        budgetSpentMinor: cached.budgetSpentMinor,
      };
    }
    return budgetTotals(this.ctx, fromDate, toDate, (onDate, budgetOptions) =>
      this.getBudgetStatuses(onDate, budgetOptions),
    );
  }

  getNetWorthSeries(
    months: number,
    today: string = todayLocal(),
  ): NetWorthSeries {
    assertNetWorthMonths(months);
    assertDate(today);
    const derived = this.derived();
    const seriesKey = `${months}|${today}`;
    const cached = derived.netWorthSeries.get(seriesKey);
    if (cached) return cached;
    const series = computeNetWorthSeries(this.ctx, months, today, (from, to) =>
      this.getDashboard(from, to),
    );
    derived.netWorthSeries.set(seriesKey, series);
    return series;
  }

  getBudgetStatuses(
    onDate: string,
    options: {
      includeInactiveCustom?: boolean;
      includePendingAutoPosts?: boolean;
    } = {},
  ): BudgetStatus[] {
    assertDate(onDate);
    if (options.includePendingAutoPosts) {
      return this.withPendingRecurring(true, onDate, () =>
        this.getBudgetStatuses(onDate, {
          includeInactiveCustom: options.includeInactiveCustom,
        }),
      );
    }
    const derived = this.derived();
    const statusKey = `${onDate}|${options.includeInactiveCustom === true}`;
    const cached = derived.budgetStatuses.get(statusKey);
    if (cached) return cached;
    const statuses = computeBudgetStatuses(this.ctx, onDate, options);
    derived.budgetStatuses.set(statusKey, statuses);
    return statuses;
  }

  getGoalProgress(goalId: string) {
    return calculateGoalProgress(
      this.ctx,
      goalId,
      this.state.goals,
      this.state.contributions,
      this.state.transactions,
    );
  }

  generateRecurring(horizonDate = todayLocal()) {
    return this.enqueueMutation(() => this.generateRecurringNow(horizonDate));
  }

  getPendingAutoPosts(onDate: string): TransactionRecord[] {
    assertDate(onDate);
    return this.pendingRecurring(onDate).filter(
      (transaction) => transaction.status === "posted",
    );
  }

  /** Everything a generation run on `onDate` would write for transactions; nothing is stored. */
  private pendingRecurring(onDate: string) {
    return this.planRecurring(onDate, onDate, { virtualIds: true })
      .transactionChanges;
  }

  /**
   * Runs the synchronous read `work` as if generation had already run for `onDate`, when
   * `include` asks for it: the pending transactions are laid over the snapshot for the duration of
   * the call only, and neither the snapshot nor the derived-read cache keeps them. A preview that
   * cannot be computed is skipped (the persisted numbers are shown) rather than failing the read.
   */
  private withPendingRecurring<T>(
    include: boolean | undefined,
    onDate: string,
    work: () => T,
  ): T {
    if (!include) return work();
    // Generation only ever runs up to today, so a read dated later (a future month's end) still
    // previews what is due today, never occurrences that are not due yet.
    const today = todayLocal();
    const horizon = onDate < today ? onDate : today;
    let pending: TransactionRecord[];
    try {
      pending = this.pendingRecurring(horizon);
    } catch {
      return work();
    }
    if (!pending.length) return work();
    const byId = new Map(pending.map((item) => [item.id, item]));
    const existing = new Set(this.state.transactions.map((item) => item.id));
    const transactions = [
      ...this.state.transactions.map((item) => byId.get(item.id) ?? item),
      ...pending.filter((item) => !existing.has(item.id)),
    ];
    const derivedCache = this.derivedCache;
    try {
      return this.withProspectiveState({ transactions }, work);
    } finally {
      this.derivedCache = derivedCache;
    }
  }

  /**
   * What a generation run for `horizonDate` would write for the recurring schedules, without
   * writing it. See `planRecurring` in `src/data/finance/recurring.ts`.
   */
  private planRecurring(
    horizonDate: string,
    today: string,
    options: { onlyRuleId?: string; virtualIds?: boolean } = {},
  ) {
    return planRecurring(
      this.ctx,
      this.recurringDeps,
      horizonDate,
      today,
      options,
    );
  }

  private async generateRecurringNow(horizonDate: string, onlyRuleId?: string) {
    assertDate(horizonDate);
    const { transactions, transactionChanges, ruleChanges, generated } =
      this.planRecurring(horizonDate, todayLocal(), { onlyRuleId });
    const recurringChanged =
      transactionChanges.length > 0 || ruleChanges.length > 0;
    // Merged into the current state rather than replacing it with the pre-await snapshot, so
    // transactions saved while putMany was in flight are not dropped.
    const changedTransactions = new Map(
      transactionChanges.map((item) => [item.id, item]),
    );
    const changedRules = new Map(ruleChanges.map((rule) => [rule.id, rule]));
    const currentIds = new Set(this.state.transactions.map((item) => item.id));
    const nextTransactions = [
      ...this.state.transactions.map(
        (item) => changedTransactions.get(item.id) ?? item,
      ),
      ...transactionChanges.filter((item) => !currentIds.has(item.id)),
    ];
    const nextRules = this.state.recurringRules.map(
      (rule) => changedRules.get(rule.id) ?? rule,
    );
    // A budget period that has just opened is priced against the transactions this run is
    // writing, so it is built from the prospective state. It is committed in the same putMany
    // as those transactions: a crash can then never leave one without the other.
    const budgetPeriods = this.withProspectiveState(
      { transactions: nextTransactions },
      () => dueBudgetSnapshots(this.ctx),
    );
    if (!recurringChanged && !budgetPeriods.length) return generated;
    if (recurringChanged) assertTransactionSetSafe(this.ctx, transactions);
    await this.storage.putMany(
      [
        ...asRecords("transactions", transactionChanges),
        ...asRecords("recurringRules", ruleChanges),
        ...asRecords("budgetPeriods", budgetPeriods),
      ],
      this,
    );
    this.state = {
      ...this.state,
      transactions: nextTransactions,
      recurringRules: nextRules,
    };
    budgetPeriods.forEach((period) =>
      this.replaceInList("budgetPeriods", period),
    );
    this.emit();
    return generated;
  }

  /**
   * Runs the catch-up generation that follows a write which has already committed. The write is
   * durable, so a failure here must not be reported as the write failing. The recurring
   * catch-up re-runs on the next load, the same way `importExternalBundleNow` treats it.
   */
  private async generateAfterCommit() {
    try {
      await this.generateRecurringNow(todayLocal());
    } catch {
      // Intentionally swallowed; see above.
    }
  }

  confirmUpcoming(id: string) {
    return this.enqueueMutation(() => this.confirmUpcomingNow(id));
  }

  private async confirmUpcomingNow(id: string) {
    const transaction = this.state.transactions.find((item) => item.id === id);
    if (!transaction || transaction.status !== "upcoming") return;
    // Paying an unpriced upcoming transaction snapshots the latest rate on or before today. With no
    // rate stored, MissingExchangeRateError propagates before any write and the row stays upcoming.
    const updated = postedWithSnapshot(
      this.ctx,
      transaction,
      todayLocal(),
      true,
    );
    if (!updated) return;
    assertTransactionSetSafe(
      this.ctx,
      withEntity(this.state.transactions, updated),
    );
    await this.commitOne("transactions", updated);
    await this.generateNextOccurrence(updated);
  }

  /**
   * Recurring occurrences are only generated once due, so resolving one (confirm or skip) would
   * otherwise leave nothing to look forward to. Generate the rule's next occurrence, unless a
   * future one is already waiting.
   */
  private async generateNextOccurrence(resolved: TransactionRecord) {
    if (!resolved.recurringRuleId) return;
    const rule = this.state.recurringRules.find(
      (item) => item.id === resolved.recurringRuleId && !item.deletedAt,
    );
    if (!rule?.active) return;
    const today = todayLocal();
    const futureWaiting = this.state.transactions.some(
      (item) =>
        item.recurringRuleId === rule.id &&
        item.status === "upcoming" &&
        item.localDate > today,
    );
    if (futureWaiting) return;
    await this.generateRecurringNow(
      rule.nextDueDate > today ? rule.nextDueDate : today,
      rule.id,
    );
  }

  skipUpcoming(id: string) {
    return this.enqueueMutation(() => this.skipUpcomingNow(id));
  }

  private async skipUpcomingNow(id: string) {
    const transaction = this.state.transactions.find((item) => item.id === id);
    if (!transaction || transaction.status !== "upcoming") return;
    const updated = updateEntity(transaction, { status: "skipped" });
    await this.commitOne("transactions", updated);
    await this.generateNextOccurrence(updated);
  }

  updateTransactionsCategory(ids: string[], categoryId: string | null) {
    return this.enqueueMutation(() =>
      this.updateTransactionsCategoryNow(ids, categoryId),
    );
  }

  private async updateTransactionsCategoryNow(
    ids: string[],
    categoryId: string | null,
  ) {
    const { updated, transactions } = planCategoryAssignment(
      this.ctx,
      ids,
      categoryId,
    );

    await this.persist("transactions", updated);
    this.state = {
      ...this.state,
      transactions,
    };
    this.emit();
  }

  updateTransactionsDate(ids: string[], localDate: string) {
    return this.enqueueMutation(() =>
      this.updateTransactionsDateNow(ids, localDate),
    );
  }

  private async updateTransactionsDateNow(ids: string[], localDate: string) {
    assertDate(localDate);
    const selected = new Set(ids);
    const moving = this.state.transactions.filter(
      (item) => selected.has(item.id) && item.localDate !== localDate,
    );
    if (!moving.length) return;
    // Rebuilt through `buildTransaction` as a full edit, so a moved transaction is validated and
    // priced like one the user re-dated in the form: rate snapshots that belonged to the old day
    // are left out and resolved again for the new one.
    const updated = moving.map((item) =>
      this.buildTransaction(redatedTransactionInput(item, localDate), item.id),
    );

    assertTransactionSetSafe(
      this.ctx,
      applyTransactionChanges(this.state.transactions, updated),
    );
    await this.persist("transactions", updated);
    this.state = {
      ...this.state,
      transactions: applyTransactionChanges(this.state.transactions, updated),
    };
    this.emit();
  }

  deleteEntities(type: keyof FinanceState, ids: string[]) {
    return this.enqueueMutation(() => this.deleteEntitiesNow(type, ids));
  }

  /**
   * `options.sweep` is the one-time cleanup of data archived before archiving was removed. It
   * skips the last-account guard (the sweep keeps one account itself) and never lets a paused
   * schedule resume: a schedule whose category is deleted stays paused.
   */
  private async deleteEntitiesNow(
    type: keyof FinanceState,
    ids: string[],
    options: { sweep?: boolean } = {},
  ) {
    if (type === "ready" || type === "settings") return;
    const plan = planEntityDeletion(this.ctx, type, ids, options);
    await this.storage.putMany(deletionRecords(plan), this);
    deletedOccurrenceKeysOf(plan).forEach((occurrenceKey) =>
      this.deletedOccurrenceKeys.add(occurrenceKey),
    );
    this.state = applyDeletion(this.state, plan);
    this.emit();
    // A rule that came back off dependency-pause has to catch up on the occurrences
    // it missed while paused, exactly as it does when the blocking account or
    // category is un-archived.
    if (plan.reactivatedRule) {
      await this.generateRecurringNow(todayLocal());
    }
  }

  mergeDuplicates(groups: readonly DuplicateGroup[]) {
    return this.enqueueMutation(() => this.mergeDuplicatesNow(groups));
  }

  /**
   * Collapses user-confirmed duplicate records into one, as ordinary entity writes.
   *
   * Pairing two vaults that both hold real data leaves two of everything the user created on
   * both devices. The repair pass renames those rather than merging them, because merging is a
   * judgement — so this is where the judgement, once made, is carried out.
   *
   * The whole operation is validated before a byte is written, and it is a single `putMany`.
   * That matters more here than almost anywhere else: a merge that half-applied would leave
   * transactions pointing at an account that was tombstoned in the same breath, and the repair
   * pass would resurrect it on every device as a live-but-archived ghost of the record the user
   * just told Qashy to get rid of.
   */
  private async mergeDuplicatesNow(groups: readonly DuplicateGroup[]) {
    const plan = planMerge(this.state, groups);
    if (!plan.records.length) return { merged: 0, retargeted: 0 };

    // Balances genuinely move when two accounts become one, so the money invariants are re-run
    // over the *projected* set rather than the current one — this is the check that catches a
    // merge whose combined opening balance and history overflow a safe integer.
    const projected = new Map(
      plan.records.map((record) => [
        `${record.type}:${record.entity.id}`,
        record.entity,
      ]),
    );
    const project = <T extends FinanceEntity>(
      type: EntityType,
      rows: readonly T[],
    ) =>
      rows
        .map(
          (row) => (projected.get(`${type}:${row.id}`) as T | undefined) ?? row,
        )
        .filter((row) => !row.deletedAt);
    assertTransactionSetSafe(
      this.ctx,
      project("transactions", this.state.transactions),
      project("accounts", this.state.accounts),
    );

    await this.storage.putMany([...plan.records], this);
    // Rehydrating rather than splicing the snapshot: a merge touches up to eight entity types
    // at once, and `deletedOccurrenceKeys` has to be rebuilt from the new tombstones so a rule
    // does not re-post the occurrence that just became the duplicate.
    await this.hydrateFromStorage();
    this.emit();
    return { merged: plan.removed, retargeted: plan.retargeted };
  }

  importCsv(rows: CsvImportRow[], commit = false) {
    // Preview is queued too, like a commit: a large file yields to the event loop between
    // batches (below), and a mutation landing in one of those gaps would make the preview read
    // two different snapshots.
    return this.enqueueMutation(() => this.importCsvNow(rows, commit));
  }

  private async importCsvNow(rows: CsvImportRow[], commit = false) {
    const { result, staged } = await stageCsvRows(this.ctx, this.build, rows);
    if (commit && staged.length) {
      const { newTags, transactions } = buildCsvTransactions(
        this.ctx,
        this.build,
        staged,
      );

      assertTransactionSetSafe(this.ctx, [
        ...this.state.transactions,
        ...transactions,
      ]);
      await this.storage.putMany(
        [
          ...asRecords("tags", newTags),
          ...asRecords("transactions", transactions),
        ],
        this,
      );
      // Append only the new tags onto current state; the pre-await `tags`
      // snapshot may be missing tags saved while putMany was in flight.
      this.state = {
        ...this.state,
        tags: [...this.state.tags, ...newTags],
        transactions: [...this.state.transactions, ...transactions],
      };
      result.committedIds = transactions.map((item) => item.id);
      this.emit();
    }
    if (result.rejectedRows.length)
      result.warnings.push("Rejected rows were not imported.");
    if (result.duplicateRows.length)
      result.warnings.push("Likely duplicates were skipped.");
    return result;
  }

  importExternalBundle(
    bundle: ImportBundle,
    options: { mode: ImportMode },
    commit = false,
  ) {
    // Preview is queued too: it awaits storage reads between `this.state` reads, so a
    // concurrent mutation would otherwise make it inconsistent.
    return this.enqueueMutation(() =>
      this.importExternalBundleNow(bundle, options.mode, commit),
    );
  }

  /**
   * Imports a bundle another app's backup was parsed into, all or nothing.
   *
   * Preview and commit share every line up to the write, so what the preview reports is what a
   * commit does. Nothing touches `this.state` until `putMany` has succeeded: validation runs
   * against a *prospective* snapshot swapped in only for the synchronous stretches that need
   * it (see `withProspectiveState`), and a failed write leaves the live snapshot as it was.
   *
   * Every id is derived from the source and the record's external id, so a second import of the
   * same file finds its own rows again instead of adding a copy. A row that exists as a
   * tombstone under a derived id is revived rather than duplicated — except transactions,
   * schedules and budgets in `merge` mode, because the user deleted those and an import must
   * not undo the deletion. Accounts, categories and tags are still revived there, since
   * imported transactions depend on them.
   */
  private importExternalBundleNow(
    importedBundle: ImportBundle,
    mode: ImportMode,
    commit: boolean,
  ): Promise<ExternalImportOutcome> {
    return runExternalImport(this.importHost(), importedBundle, mode, commit);
  }

  /** What an external import needs from this repository; see `ExternalImportHost`. */
  private importHost(): ExternalImportHost {
    // `repository` keeps `this` for the getter below; the arrow functions capture it directly.
    const repository = this;
    return {
      ctx: this.ctx,
      storage: this.storage,
      source: this,
      // A getter, so the deps (and `deletedOccurrenceKeys`) are read when the import uses them.
      get recurringDeps() {
        return repository.recurringDeps;
      },
      buildTransaction: this.build,
      withProspectiveState: (patch, work) =>
        this.withProspectiveState(patch, work),
      hydrate: () => this.hydrateFromStorage(),
      emit: () => this.emit(),
      scheduleRefresh: () => {
        this.pendingExternalRefresh = true;
      },
      generateAfterCommit: () => this.generateAfterCommit(),
    };
  }

  /**
   * Runs `work` with `this.state` temporarily replaced by `patch` laid over the real one.
   *
   * The validators an import reuses (`validateRecurring`, `validateBudget`, `buildTransaction`,
   * the safety asserts) all read `this.state`, and the entities they must be checked against do
   * not exist yet — they are only proposed. This lets them run unchanged over the proposal
   * without copying their rules, and without writing anything to the real snapshot.
   *
   * It is safe only because the swap is synchronous end to end: nothing can interleave, no
   * listener is notified, and the original is restored in `finally` even when `work` throws.
   * `work` must therefore never await; a promise is rejected outright, because by the time it
   * settled the real state would be back and the awaited code would validate against the wrong
   * one.
   */
  private withProspectiveState<T>(
    patch: Partial<FinanceState>,
    work: () => T,
  ): T {
    const original = this.state;
    this.state = { ...original, ...patch };
    try {
      const result = work();
      if (result instanceof Promise)
        throw new Error("A prospective validation must be synchronous.");
      return result;
    } finally {
      this.state = original;
    }
  }

  exportCsv() {
    return buildCsvExport(this.ctx);
  }

  resetAllData() {
    return this.enqueueMutation(() => this.resetAllDataNow());
  }

  private async resetAllDataNow() {
    // Nothing below this line may touch `this.state` until the disk wipe has
    // succeeded, so a failing `clear()` leaves the snapshot intact.
    await this.storage.clear(this);
    const next = { ...createInitialState(), ready: true };
    this.deletedOccurrenceKeys.clear();
    this.state = next;
    this.emit();
    // Nothing is re-seeded. The wipe is already the source of truth: an empty store
    // rehydrates to exactly `createInitialState()` on next launch, and a reset returns the
    // app to onboarding, which is what writes the settings row. Seeding a placeholder here
    // would put the app default base currency into that row's `create` op — see the note in
    // `initializeNow` for why a `createOnly` field written from a placeholder is a trap.
  }

  private enqueueMutation<T>(operation: () => Promise<T>) {
    const run = this.mutationQueue.then(async () => {
      this.mutationActive = true;
      try {
        return await operation();
      } finally {
        this.mutationActive = false;
      }
    });
    // Draining inside the queue chain keeps the reload ordered against the next
    // mutation, and calling `hydrateFromStorage` directly avoids re-entering
    // `enqueueMutation` on the very promise being assigned here.
    this.mutationQueue = run.then(
      this.drainExternalRefresh,
      this.drainExternalRefresh,
    );
    return run;
  }

  // Deliberately synchronous when there is nothing to drain: returning a promise
  // unconditionally would add microtask latency to every mutation handoff, which
  // is observable to callers that interleave work between queued mutations.
  private drainExternalRefresh = () => {
    if (!this.pendingExternalRefresh || !this.state.ready) return undefined;
    this.pendingExternalRefresh = false;
    return this.hydrateFromStorage().then(
      () => this.emit(),
      () => {
        // Leave the snapshot untouched and retry after the next mutation rather
        // than rejecting, which would wedge the queue for every later call.
        this.pendingExternalRefresh = true;
      },
    );
  };

  private async hydrateFromStorage() {
    // One read transaction, so the settings and every entity type come from the same committed
    // state. Separate reads could straddle a write from another tab and pair settings with
    // entities that were never stored together. `silent`: a read notifies no one, and the
    // external-change subscriber would otherwise re-trigger this very refresh.
    const { settingsRecords, loaded } = await this.storage.transact(
      async (tx) => ({
        settingsRecords: await tx.readAll("settings"),
        loaded: await Promise.all(ENTITY_TYPES.map((type) => tx.readAll(type))),
      }),
      { silent: true },
    );
    const storedSettings = (settingsRecords.find(
      (item) => item.id === "settings" && !item.deletedAt,
    ) ?? initialSettings()) as AppSettings;
    // A row missing a device-local field reads as its default.
    const settings: AppSettings = {
      ...storedSettings,
      themeId: storedSettings.themeId ?? DEFAULT_THEME_ID,
      swipeBetweenMonths: storedSettings.swipeBetweenMonths ?? true,
      swipeRowActions: storedSettings.swipeRowActions ?? true,
      navBarStyle: storedSettings.navBarStyle ?? "native",
      animationLevel: storedSettings.animationLevel ?? "all",
      monthSlideStyle: storedSettings.monthSlideStyle ?? "cascade",
      hapticsEnabled: storedSettings.hapticsEnabled ?? true,
      fontTextOverride: storedSettings.fontTextOverride ?? null,
      fontNumericOverride: storedSettings.fontNumericOverride ?? null,
      uiIconSetOverride: storedSettings.uiIconSetOverride ?? null,
      categoryIconSetOverride: storedSettings.categoryIconSetOverride ?? null,
    };
    const loadedTransactions = loaded[
      ENTITY_TYPES.indexOf("transactions")
    ] as TransactionRecord[];
    this.deletedOccurrenceKeys = new Set(
      loadedTransactions
        .filter(
          (transaction) => transaction.deletedAt && transaction.occurrenceKey,
        )
        .map((transaction) => transaction.occurrenceKey!),
    );
    // Carry the current readiness rather than asserting it. Hydration is only the
    // first step of `initializeNow`; the settings seed and recurring
    // generation still follow. Flipping `ready` here published a half-initialized
    // snapshot to any render that polled `getSnapshot` before `emit()` ran.
    // Reuse the current settings object when nothing in it changed. A reload builds a fresh one
    // every time, and its identity is what the settings-only subscribers key on, so without this
    // every resume would re-render the root navigator and both providers for no reason.
    const previousSettings = this.state.settings;
    const stableSettings =
      JSON.stringify(previousSettings) === JSON.stringify(settings)
        ? previousSettings
        : settings;
    const next = {
      ...createInitialState(),
      settings: stableSettings,
      ready: this.state.ready,
    } as FinanceState;
    ENTITY_TYPES.forEach((type, index) => {
      (next[type] as FinanceEntity[]) = loaded[index].filter(
        (entity) => !entity.deletedAt,
      );
    });
    this.state = next;
  }

  private async saveListEntity<T extends FinanceEntity>(
    type: ListKey,
    input: Omit<T, keyof import("@/domain/models").SyncEntity>,
    id?: string,
    expectedRevision?: number,
  ) {
    const list = this.state[type] as T[];
    const existing = findExisting(list, id, type.slice(0, -1));
    assertExpectedRevision(existing, input, expectedRevision);
    const entity = existing
      ? updateEntity(existing, input as Partial<T>)
      : createEntity<T>({ id: makeId(), ...input } as T);
    await this.commitOne(type, entity);
    return entity;
  }

  private buildTransaction(
    input: TransactionInput,
    id?: string,
    additionalTagIds: string[] = [],
    expectedRevision?: number,
    newId?: string,
  ) {
    return buildTransaction(
      this.ctx,
      input,
      id,
      additionalTagIds,
      expectedRevision,
      newId,
    );
  }

  private replaceInList(type: ListKey, entity: FinanceEntity) {
    this.state = {
      ...this.state,
      [type]: withEntity(this.state[type] as FinanceEntity[], entity),
    };
  }

  /** Persists one entity, then swaps it into the snapshot and notifies subscribers. */
  private async commitOne(type: ListKey, entity: FinanceEntity) {
    await this.persist(type, [entity]);
    this.replaceInList(type, entity);
    this.emit();
  }

  private async persist(type: EntityType, entities: FinanceEntity[]) {
    await this.storage.putMany(asRecords(type, entities), this);
  }

  /** Posted rows, and posted rows of a date window, shared by every caller of one snapshot. */
  private postedTransactions(fromDate?: string, toDate?: string) {
    const source = this.state.transactions;
    let entry = this.postedCache.get(source);
    if (!entry) {
      entry = {
        all: source.filter(
          (item) => !item.deletedAt && item.status === "posted",
        ),
        ranges: new Map(),
      };
      this.postedCache.set(source, entry);
    }
    if (fromDate === undefined && toDate === undefined) return entry.all;
    const key = `${fromDate ?? ""}|${toDate ?? ""}`;
    let range = entry.ranges.get(key);
    if (!range) {
      range = entry.all.filter(
        (item) =>
          (fromDate === undefined || item.localDate >= fromDate) &&
          (toDate === undefined || item.localDate <= toDate),
      );
      entry.ranges.set(key, range);
    }
    return range;
  }

  private transactionById(transactions: TransactionRecord[]) {
    let index = this.transactionIndexCache.get(transactions);
    if (!index) {
      index = new Map(transactions.map((item) => [item.id, item]));
      this.transactionIndexCache.set(transactions, index);
    }
    return index;
  }

  /** The cache for reads derived from the current snapshot; reset when any input array changes. */
  private derived() {
    const { state } = this;
    const deps = [
      state.transactions,
      state.accounts,
      state.categories,
      state.budgets,
      state.budgetPeriods,
      state.budgetAdjustments,
      state.exchangeRates,
      state.settings,
      this.displayLocale,
      todayLocal(),
    ];
    const cached = this.derivedCache;
    if (cached && cached.deps.every((dep, index) => dep === deps[index]))
      return cached;
    this.derivedCache = {
      deps,
      dashboards: new Map(),
      netWorthSeries: new Map(),
      budgetStatuses: new Map(),
    };
    return this.derivedCache;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

/**
 * The app's storage, with change capture wrapped around it.
 *
 * Installed unconditionally and left **unarmed** — it captures nothing until
 * `SyncProvider` calls `setDeviceId` with a vault's device id. Wrapping it here rather than
 * only once sync is switched on is what makes turning sync on a pure configuration change:
 * the alternative would be swapping the adapter under a repository that is already holding a
 * snapshot and a subscription, at the exact moment the user is least willing to lose data.
 *
 * Exported because the provider needs the handle to arm it. Nothing else should touch it.
 */
export const syncingStorage = new SyncingStorageAdapter(
  new PlatformStorageAdapter(),
  null,
);

export const financeRepository = new LocalFinanceRepository(syncingStorage);
