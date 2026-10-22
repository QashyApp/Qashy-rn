import { emptyImportCounts } from "@/data/import/external-import";
import { omitArchived } from "@/data/import/omit-archived";
import type {
  ExternalImportOutcome,
  ImportBundle,
  ImportMode,
} from "@/data/import/types";
import { assertBudgetSetSafe } from "@/data/finance/budgets";
import {
  existingTransactionKeys,
  importAccounts,
  importBudgets,
  importCategories,
  importRecurringRules,
  importTags,
  importTransactions,
  makeResolvers,
  reasonOf,
  type ExternalImportHost,
  type ImportedEntities,
  type ImportedRows,
  type ImportRun,
  type StoredRows,
} from "@/data/finance/external-import-steps";
import { assertRecurringRuleGenerationSafe } from "@/data/finance/recurring";
import { asRecords } from "@/data/finance/records";
import { assertTransactionSetSafe } from "@/data/finance/safety";
import { recordKey, type StoredEntity } from "@/data/storage-adapter";
import { hasSyncHistory } from "@/data/sync-store";
import type {
  Account,
  Budget,
  Category,
  EntityType,
  FinanceEntity,
  FinanceState,
  RecurringRule,
  Tag,
  TransactionRecord,
} from "@/domain/models";
import { todayLocal } from "@/utils/date";
import { externalImportId } from "@/utils/deterministic-id";
import { updateEntity } from "@/utils/entity";

// Re-exported for the repository, which builds the host an import runs against.
export type { ExternalImportHost } from "@/data/finance/external-import-steps";

/**
 * What a replace-import deletes: every finance entity the backup stands in for. Settings and
 * exchange rates are not part of a backup's content, so they are kept.
 */
const REPLACED_TYPES: EntityType[] = [
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
];

const REPLACE_NEEDS_NO_SYNC_MESSAGE =
  "Your current data can’t be deleted for real while this device syncs: your other devices would keep it and send it back. Remove this device from sync first, or choose “Add to my current data”.";

/**
 * Imports a bundle another app's backup was parsed into, all or nothing.
 *
 * Preview and commit share every line up to the write, so what the preview reports is what a
 * commit does. Nothing touches the repository's snapshot until `putMany` has succeeded:
 * validation runs against a *prospective* snapshot swapped in only for the synchronous
 * stretches that need it (see `withProspectiveState`), and a failed write leaves the live
 * snapshot as it was.
 *
 * Every id is derived from the source and the record's external id, so a second import of the
 * same file finds its own rows again instead of adding a copy. A row that exists as a
 * tombstone under a derived id is revived rather than duplicated — except transactions,
 * schedules and budgets in `merge` mode, because the user deleted those and an import must
 * not undo the deletion. Accounts, categories and tags are still revived there, since
 * imported transactions depend on them.
 */
export async function runExternalImport(
  host: ExternalImportHost,
  importedBundle: ImportBundle,
  mode: ImportMode,
  commit: boolean,
): Promise<ExternalImportOutcome> {
  if (mode !== "merge" && mode !== "replace")
    throw new Error("Choose how to import: merge or replace.");
  // Nothing is archived here, so a bundle that still carries archived items has them left out,
  // exactly as the reader does. A no-op for a bundle the reader already cleaned.
  const bundle = omitArchived(importedBundle).parts;
  // Base-currency snapshots and the settings row come from onboarding, and onboarding
  // refuses to run once any entity exists, so importing first would strand the vault.
  if (!host.ctx.state.settings.onboardingComplete)
    throw new Error("Finish setting up Qashy before importing.");
  const stored = await readStoredRows(host);
  const run = createImportRun(host, bundle, mode, stored);
  const { outcome } = run;

  const entities: ImportedEntities = {
    ...importAccounts(run, bundle),
    ...importCategories(run, bundle),
    ...importTags(run, bundle),
  };
  const resolvers = makeResolvers(entities);
  const { existingKeys, retainedTransactions } = existingTransactionKeys(run);
  const newRules = importRecurringRules(run, bundle, entities, resolvers);
  const newTransactions = importTransactions(
    run,
    bundle,
    entities,
    resolvers,
    existingKeys,
  );
  const newBudgets = importBudgets(run, bundle, entities, resolvers);
  const imported: ImportedRows = {
    newAccounts: entities.newAccounts,
    newCategories: entities.newCategories,
    newTags: entities.newTags,
    newTransactions,
    newBudgets,
    newRules,
  };
  checkWholeSetSafe(run, entities, retainedTransactions, imported);
  await summarizeOutcome(run, imported);

  if (!commit) return outcome;
  if (outcome.rejected.length) {
    throw new Error(
      `Import blocked: ${outcome.rejected.length} item(s) could not be imported, so nothing was imported.`,
    );
  }
  return commitImport(run, imported);
}

/**
 * Tombstones are invisible to the snapshot, and they decide whether a derived id is a revival or
 * a fresh row, so the stored rows are read for that one purpose.
 */
async function readStoredRows(host: ExternalImportHost): Promise<StoredRows> {
  const readStored = async <T extends FinanceEntity>(type: EntityType) =>
    new Map(
      ((await host.storage.readAll(type)) as T[]).map((entity) => [
        entity.id,
        entity,
      ]),
    );
  return {
    accounts: await readStored<Account>("accounts"),
    categories: await readStored<Category>("categories"),
    tags: await readStored<Tag>("tags"),
    transactions: await readStored<TransactionRecord>("transactions"),
    budgets: await readStored<Budget>("budgets"),
    recurringRules: await readStored<RecurringRule>("recurringRules"),
  };
}

function createImportRun(
  host: ExternalImportHost,
  bundle: ImportBundle,
  mode: ImportMode,
  stored: StoredRows,
): ImportRun {
  const ctx = host.ctx;
  const replacing = mode === "replace";
  const source = bundle.source;
  const idOf = (
    type: Parameters<typeof externalImportId>[1],
    externalId: string,
  ) => externalImportId(source, type, externalId);
  const outcome: ExternalImportOutcome = {
    committed: false,
    created: emptyImportCounts(),
    reused: { accounts: 0, categories: 0, tags: 0 },
    duplicateTransactions: 0,
    replaced: { ...emptyImportCounts(), goals: 0 },
    rejected: [],
    renamed: [],
  };
  const reject = (externalId: string, reason: string) => {
    outcome.rejected.push({ externalId, reason });
  };
  // True the first time an external id of this kind appears; later repeats are rejected.
  const firstSighting = (kind: string) => {
    const seen = new Set<string>();
    return (externalId: string) => {
      if (seen.has(externalId)) {
        reject(externalId, `The backup lists this ${kind} more than once.`);
        return false;
      }
      seen.add(externalId);
      return true;
    };
  };
  // What `merge` may reuse. In `replace` nothing of the old vault survives, so nothing in it
  // can be reused or collide by name, and only the imported entities compete for names.
  const liveAccounts = replacing ? [] : ctx.state.accounts;
  const liveCategories = replacing ? [] : ctx.state.categories;
  const liveTags = replacing ? [] : ctx.state.tags;
  const liveBudgets = replacing ? [] : ctx.state.budgets;
  const liveRules = replacing ? [] : ctx.state.recurringRules;

  // A reused entity that is archived in the vault cannot take new postings.
  const archivedVaultAccounts = new Set(
    liveAccounts.filter((item) => item.archived).map((item) => item.id),
  );
  const archivedVaultCategories = new Set(
    liveCategories.filter((item) => item.archived).map((item) => item.id),
  );
  const replacingLedger: Partial<FinanceState> = replacing
    ? { recurringRules: [], transactions: [] }
    : {};
  return {
    host,
    ctx,
    replacing,
    source,
    idOf,
    outcome,
    reject,
    firstSighting,
    stored,
    liveAccounts,
    liveCategories,
    liveTags,
    liveBudgets,
    liveRules,
    archivedVaultAccounts,
    archivedVaultCategories,
    replacingLedger,
  };
}

function checkWholeSetSafe(
  run: ImportRun,
  entities: ImportedEntities,
  retainedTransactions: TransactionRecord[],
  imported: ImportedRows,
) {
  const { ctx, host, replacing, outcome, reject, liveBudgets } = run;
  const { buildAccounts, buildCategories, buildTags } = entities;
  const { newTransactions, newBudgets, newRules } = imported;
  // Skipped once anything was rejected: the set is incomplete, so an overflow reported over
  // it would describe a vault that is never going to exist.
  if (!outcome.rejected.length) {
    try {
      host.withProspectiveState(
        {
          accounts: buildAccounts,
          categories: buildCategories,
          tags: buildTags,
          ...(replacing
            ? {
                transactions: [],
                budgets: [],
                budgetPeriods: [],
                budgetAdjustments: [],
                goals: [],
                contributions: [],
                recurringRules: [],
              }
            : {}),
        },
        () => {
          const transactions = [...retainedTransactions, ...newTransactions];
          assertTransactionSetSafe(ctx, transactions, buildAccounts);
          assertBudgetSetSafe([...liveBudgets, ...newBudgets]);
          for (const rule of newRules) {
            assertRecurringRuleGenerationSafe(
              ctx,
              host.recurringDeps,
              rule,
              transactions,
              todayLocal(),
            );
          }
        },
      );
    } catch (error) {
      reject("import", reasonOf(error));
    }
  }
}

/** Fills in what the import created and, for a replace, what it would erase. */
async function summarizeOutcome(run: ImportRun, imported: ImportedRows) {
  const { ctx, host, replacing, outcome, reject } = run;
  const {
    newAccounts,
    newCategories,
    newTags,
    newTransactions,
    newBudgets,
    newRules,
  } = imported;
  outcome.created = {
    accounts: newAccounts.length,
    categories: newCategories.length,
    tags: newTags.length,
    transactions: newTransactions.length,
    recurringRules: newRules.length,
    budgets: newBudgets.length,
  };
  if (replacing) {
    outcome.replaced = {
      accounts: ctx.state.accounts.length,
      categories: ctx.state.categories.length,
      tags: ctx.state.tags.length,
      transactions: ctx.state.transactions.length,
      recurringRules: ctx.state.recurringRules.length,
      budgets: ctx.state.budgets.length,
      goals: ctx.state.goals.length,
    };
    // A replace really erases, and that is only coherent on a device that does not sync. The
    // commit checks again inside its own transaction; this is what lets a preview say so first.
    if (
      await host.storage.transact((tx) => hasSyncHistory(tx), {
        silent: true,
      })
    )
      reject("replace", REPLACE_NEEDS_NO_SYNC_MESSAGE);
  }
}

/** Writes the imported rows, rehydrates the snapshot and runs the recurring catch-up. */
async function commitImport(
  run: ImportRun,
  imported: ImportedRows,
): Promise<ExternalImportOutcome> {
  const { host, replacing, outcome, stored } = run;
  const {
    newAccounts,
    newCategories,
    newTags,
    newTransactions,
    newBudgets,
    newRules,
  } = imported;
  // In `merge`, overwrites a tombstone that already holds this id, bumping the revision
  // instead of restarting it at 1, so the op log records a revival and never a second "create"
  // of the same entity. A `replace` erases the old rows first, so there is nothing to revive:
  // every imported entity is simply new.
  const settle = <T extends FinanceEntity>(
    fresh: T,
    previous: ReadonlyMap<string, T>,
  ): T => {
    const old = replacing ? undefined : previous.get(fresh.id);
    return old
      ? updateEntity(old, { ...fresh, deletedAt: null } as Partial<T>)
      : fresh;
  };
  const records: StoredEntity[] = [
    ...asRecords(
      "accounts",
      newAccounts.map((fresh) => settle(fresh, stored.accounts)),
    ),
    ...asRecords(
      "categories",
      newCategories.map((fresh) => settle(fresh, stored.categories)),
    ),
    ...asRecords(
      "tags",
      newTags.map((fresh) => settle(fresh, stored.tags)),
    ),
    ...asRecords(
      "transactions",
      newTransactions.map((fresh) => settle(fresh, stored.transactions)),
    ),
    ...asRecords(
      "budgets",
      newBudgets.map((fresh) => settle(fresh, stored.budgets)),
    ),
    ...asRecords(
      "recurringRules",
      newRules.map((fresh) => settle(fresh, stored.recurringRules)),
    ),
  ];
  // Nothing new (a re-import) writes nothing and captures no ops. A replace still has the old
  // data to erase.
  if (!records.length && !replacing) {
    outcome.committed = true;
    return outcome;
  }
  if (replacing) {
    // One transaction: the old rows (live and already-deleted alike) go and the backup's come
    // in together, or nothing changes. Written through `transact`, which captures no ops, so
    // it must never run where an op log exists for these rows; the check sits inside the
    // transaction so nothing can pair this device between the preview and now.
    await host.storage.transact(
      async (tx) => {
        if (await hasSyncHistory(tx))
          throw new Error(REPLACE_NEEDS_NO_SYNC_MESSAGE);
        for (const type of REPLACED_TYPES) {
          const rows = await tx.readAll(type);
          if (rows.length)
            await tx.deleteKeys(rows.map((row) => recordKey(type, row.id)));
        }
        await tx.putMany(records);
      },
      { source: host.source },
    );
  } else {
    await host.storage.putMany(records, host.source);
  }
  // Rehydrate rather than splice: an import touches up to nine entity types, revives
  // tombstones, and (in `replace`) retires occurrence keys, all of which `hydrateFromStorage`
  // already derives from the stored rows.
  // The import is durable from here on, so its outcome is settled before anything below can fail.
  outcome.committed = true;
  let refreshed = true;
  try {
    await host.hydrate();
    host.emit();
  } catch {
    // A failed reload leaves the snapshot stale, not the import unsaved. Retry the reload once
    // the queue settles, and skip the catch-up below, which would otherwise run against stale
    // state. The next load runs it anyway.
    refreshed = false;
    host.scheduleRefresh();
  }
  if (refreshed) {
    // Same catch-up `saveAccountNow` does, so imported schedules show their upcoming
    // occurrences and imported budgets get their current period straight away.
    await host.generateAfterCommit();
  }
  return outcome;
}
