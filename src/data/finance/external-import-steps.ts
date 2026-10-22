import { orderParentsFirst, uniquifyName } from "@/data/import/external-import";
import type { ExternalImportOutcome, ImportBundle } from "@/data/import/types";
import type { FinanceContext } from "@/data/finance/context";
import {
  validateRecurring,
  type RecurringDeps,
} from "@/data/finance/recurring";
import {
  transactionDuplicateKey,
  type BuildTransaction,
} from "@/data/finance/transactions";
import {
  ACCOUNT_TYPES,
  assertColor,
  assertSafeMinor,
  CATEGORY_KINDS,
  normalizeCurrency,
  validateBudget,
} from "@/data/finance/validation";
import type { StorageAdapter } from "@/data/storage-adapter";
import type {
  Account,
  Budget,
  Category,
  FinanceState,
  RecurringRule,
  Tag,
  TransactionRecord,
} from "@/domain/models";
import { externalImportId } from "@/utils/deterministic-id";
import { createEntity } from "@/utils/entity";
import { normalizeName } from "@/utils/naming";

/**
 * What an import needs from the repository: its live snapshot, its storage, and the few
 * operations that have to stay on the repository (the transaction builder, the temporary
 * snapshot swap, rehydration and the notification after a commit).
 */
export interface ExternalImportHost {
  readonly ctx: FinanceContext;
  readonly storage: StorageAdapter;
  /** The repository itself: the `source` its writes carry, so it ignores its own change notifications. */
  readonly source: object;
  readonly recurringDeps: RecurringDeps;
  buildTransaction: BuildTransaction;
  withProspectiveState<T>(patch: Partial<FinanceState>, work: () => T): T;
  hydrate(): Promise<void>;
  emit(): void;
  /** Ask for a reload once the mutation queue settles (the reload after a commit failed). */
  scheduleRefresh(): void;
  generateAfterCommit(): Promise<void>;
}

export type ExternalIdType = Parameters<typeof externalImportId>[1];

/** The stored rows (tombstones included) a derived id can already belong to. */
export interface StoredRows {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  tags: Map<string, Tag>;
  transactions: Map<string, TransactionRecord>;
  budgets: Map<string, Budget>;
  recurringRules: Map<string, RecurringRule>;
}

/** What every step of one import shares. */
export interface ImportRun {
  host: ExternalImportHost;
  ctx: FinanceContext;
  replacing: boolean;
  source: ImportBundle["source"];
  idOf: (type: ExternalIdType, externalId: string) => string;
  outcome: ExternalImportOutcome;
  reject: (externalId: string, reason: string) => void;
  firstSighting: (kind: string) => (externalId: string) => boolean;
  stored: StoredRows;
  liveAccounts: Account[];
  liveCategories: Category[];
  liveTags: Tag[];
  liveBudgets: Budget[];
  liveRules: RecurringRule[];
  archivedVaultAccounts: Set<string>;
  archivedVaultCategories: Set<string>;
  /** In `replace` the old ledger is out of the picture while the imported one is validated. */
  replacingLedger: Partial<FinanceState>;
}

/** The accounts, categories and tags of the backup, resolved against the vault. */
export interface ImportedEntities {
  accountIds: Map<string, string>;
  newAccounts: Account[];
  buildAccounts: Account[];
  categoryIds: Map<string, string>;
  newCategories: Category[];
  buildCategories: Category[];
  tagIds: Map<string, string>;
  newTags: Tag[];
  buildTags: Tag[];
}

export interface Resolvers {
  resolveAccount: (externalId: string) => string;
  resolveCategory: (externalId: string) => string;
  resolveTags: (externalIds: readonly string[]) => string[];
}

/** Everything the import would write. */
export interface ImportedRows {
  newAccounts: Account[];
  newCategories: Category[];
  newTags: Tag[];
  newTransactions: TransactionRecord[];
  newBudgets: Budget[];
  newRules: RecurringRule[];
}

export const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : "Could not be imported.";

export function importAccounts(run: ImportRun, bundle: ImportBundle) {
  const { liveAccounts, source, idOf, outcome, reject, firstSighting } = run;
  const accountIds = new Map<string, string>();
  const newAccounts: Account[] = [];
  // `buildTransaction` refuses to post to an archived account, and an imported archived
  // account has history that must still be importable. So the *view* used to build and
  // validate holds a non-archived copy of each new account while the entity that is written
  // keeps the flag from the backup.
  const buildAccounts: Account[] = [...liveAccounts];
  const takenAccountNames = new Set(
    liveAccounts.map((item) => normalizeName(item.name)),
  );
  const seenAccounts = firstSighting("account");
  for (const item of bundle.accounts) {
    if (!seenAccounts(item.externalId)) continue;
    try {
      const derivedId = idOf("account", item.externalId);
      const currency = normalizeCurrency(item.currency);
      assertSafeMinor(item.openingBalanceMinor, "Opening balance");
      const color = item.color.toUpperCase();
      assertColor(color);
      if (!ACCOUNT_TYPES.includes(item.type))
        throw new Error("Choose a valid account type.");
      const name = item.name.trim() || "Account";
      const sameId = liveAccounts.find((entity) => entity.id === derivedId);
      if (sameId && sameId.currency !== currency) {
        throw new Error(
          "An account imported earlier has a different currency now.",
        );
      }
      const reusable =
        sameId ??
        liveAccounts.find(
          (entity) =>
            normalizeName(entity.name) === normalizeName(name) &&
            entity.currency === currency,
        );
      if (reusable) {
        accountIds.set(item.externalId, reusable.id);
        outcome.reused.accounts += 1;
        continue;
      }
      const finalName = uniquifyName(source, name, takenAccountNames);
      if (finalName !== name)
        outcome.renamed.push({ kind: "account", from: name, to: finalName });
      takenAccountNames.add(normalizeName(finalName));
      const account = createEntity({
        id: derivedId,
        name: finalName,
        type: item.type,
        currency,
        openingBalanceMinor: item.openingBalanceMinor,
        icon: item.icon,
        color,
        archived: false,
      }) as Account;
      accountIds.set(item.externalId, account.id);
      newAccounts.push(account);
      buildAccounts.push({ ...account, archived: false });
    } catch (error) {
      reject(item.externalId, reasonOf(error));
    }
  }
  return { accountIds, newAccounts, buildAccounts };
}

export function importCategories(run: ImportRun, bundle: ImportBundle) {
  const { liveCategories, source, idOf, outcome, reject, firstSighting } = run;
  const categoryIds = new Map<string, string>();
  const newCategories: Category[] = [];
  const buildCategories: Category[] = [...liveCategories];
  const takenCategoryNames = new Set(
    liveCategories.map((item) => normalizeName(item.name)),
  );
  const seenCategories = firstSighting("category");
  // Parents first: a child is validated against the parent it resolved to, and a backup's
  // row order says nothing about which of the two comes first.
  for (const item of orderParentsFirst(bundle.categories)) {
    if (!seenCategories(item.externalId)) continue;
    try {
      const derivedId = idOf("category", item.externalId);
      if (!CATEGORY_KINDS.includes(item.kind))
        throw new Error("Choose a valid category kind.");
      const color = item.color.toUpperCase();
      assertColor(color);
      const name = item.name.trim() || "Category";
      const sameId = liveCategories.find((entity) => entity.id === derivedId);
      if (sameId && sameId.kind !== item.kind) {
        throw new Error(
          "A category imported earlier has a different kind now.",
        );
      }
      const reusable =
        sameId ??
        liveCategories.find(
          (entity) =>
            normalizeName(entity.name) === normalizeName(name) &&
            entity.kind === item.kind,
        );
      if (reusable) {
        categoryIds.set(item.externalId, reusable.id);
        outcome.reused.categories += 1;
        continue;
      }
      let parentId: string | null = null;
      if (item.parentExternalId !== null) {
        parentId = categoryIds.get(item.parentExternalId) ?? null;
        const parent = parentId
          ? buildCategories.find((entity) => entity.id === parentId)
          : undefined;
        // The rule `repairMergedState` enforces: a live, top-level parent of the same kind.
        // An archived parent is allowed — the repair does not object, and an archived group
        // can legitimately still own history.
        if (!parent || parent.kind !== item.kind || parent.parentId) {
          throw new Error(
            "Choose a valid top-level parent category of the same kind.",
          );
        }
      }
      const finalName = uniquifyName(source, name, takenCategoryNames);
      if (finalName !== name)
        outcome.renamed.push({ kind: "category", from: name, to: finalName });
      takenCategoryNames.add(normalizeName(finalName));
      const category = createEntity({
        id: derivedId,
        name: finalName,
        kind: item.kind,
        icon: item.icon,
        color,
        parentId,
        archived: false,
      }) as Category;
      categoryIds.set(item.externalId, category.id);
      newCategories.push(category);
      buildCategories.push({ ...category, archived: false });
    } catch (error) {
      reject(item.externalId, reasonOf(error));
    }
  }
  return { categoryIds, newCategories, buildCategories };
}

export function importTags(run: ImportRun, bundle: ImportBundle) {
  const { liveTags, source, idOf, outcome, reject, firstSighting } = run;
  const tagIds = new Map<string, string>();
  const newTags: Tag[] = [];
  const buildTags: Tag[] = [...liveTags];
  const takenTagNames = new Set(
    liveTags.map((item) => normalizeName(item.name)),
  );
  const seenTags = firstSighting("tag");
  for (const item of bundle.tags) {
    if (!seenTags(item.externalId)) continue;
    try {
      const derivedId = idOf("tag", item.externalId);
      const name = item.name.trim();
      if (!name) throw new Error("Tag name is required.");
      const color = item.color.toUpperCase();
      assertColor(color);
      const reusable =
        liveTags.find((entity) => entity.id === derivedId) ??
        liveTags.find(
          (entity) => normalizeName(entity.name) === normalizeName(name),
        );
      if (reusable) {
        tagIds.set(item.externalId, reusable.id);
        outcome.reused.tags += 1;
        continue;
      }
      const finalName = uniquifyName(source, name, takenTagNames);
      if (finalName !== name)
        outcome.renamed.push({ kind: "tag", from: name, to: finalName });
      takenTagNames.add(normalizeName(finalName));
      const tag = createEntity({
        id: derivedId,
        name: finalName,
        color,
      }) as Tag;
      tagIds.set(item.externalId, tag.id);
      newTags.push(tag);
      buildTags.push(tag);
    } catch (error) {
      reject(item.externalId, reasonOf(error));
    }
  }
  return { tagIds, newTags, buildTags };
}

export function makeResolvers({
  accountIds,
  categoryIds,
  tagIds,
}: ImportedEntities): Resolvers {
  const resolveAccount = (externalId: string) => {
    const id = accountIds.get(externalId);
    if (!id) throw new Error("Its account could not be imported.");
    return id;
  };
  const resolveCategory = (externalId: string) => {
    const id = categoryIds.get(externalId);
    if (!id) throw new Error("Its category could not be imported.");
    return id;
  };
  const resolveTags = (externalIds: readonly string[]) =>
    externalIds.map((externalId) => {
      const id = tagIds.get(externalId);
      if (!id) throw new Error("One of its tags could not be imported.");
      return id;
    });
  return { resolveAccount, resolveCategory, resolveTags };
}

/** The duplicate keys of the vault's transactions, and the transactions the import keeps. */
export function existingTransactionKeys(run: ImportRun) {
  const { ctx, replacing } = run;
  // Computed against the real snapshot, before any prospective one is swapped in, because
  // the key resolves tag ids to names through `ctx.state.tags`.
  const existingKeys = replacing
    ? new Set<string>()
    : new Set(
        ctx.state.transactions.map((item) =>
          transactionDuplicateKey(ctx, item),
        ),
      );
  const retainedTransactions = replacing ? [] : ctx.state.transactions;
  return { existingKeys, retainedTransactions };
}

export function importRecurringRules(
  run: ImportRun,
  bundle: ImportBundle,
  entities: ImportedEntities,
  resolvers: Resolvers,
) {
  const {
    ctx,
    host,
    replacing,
    idOf,
    reject,
    firstSighting,
    liveRules,
    stored,
    archivedVaultAccounts,
    archivedVaultCategories,
    replacingLedger,
  } = run;
  const {
    newAccounts,
    newCategories,
    buildAccounts,
    buildCategories,
    buildTags,
  } = entities;
  const { resolveAccount, resolveCategory, resolveTags } = resolvers;
  const newRules: RecurringRule[] = [];
  // Rules are validated as though no account or category were archived, then paused if one
  // is: that is exactly what archiving does to a rule (`saveAccountNow`), so an archived
  // dependency must not make the whole import unimportable.
  const unarchived = <T extends { archived: boolean }>(list: readonly T[]) =>
    list.map((item) => ({ ...item, archived: false }));
  const archivedAccountIds = new Set([
    ...archivedVaultAccounts,
    ...newAccounts.filter((item) => item.archived).map((item) => item.id),
  ]);
  const archivedCategoryIds = new Set([
    ...archivedVaultCategories,
    ...newCategories.filter((item) => item.archived).map((item) => item.id),
  ]);
  const seenRules = firstSighting("schedule");
  host.withProspectiveState(
    {
      accounts: unarchived(buildAccounts),
      categories: unarchived(buildCategories),
      tags: buildTags,
      ...replacingLedger,
    },
    () => {
      for (const item of bundle.recurringRules) {
        if (!seenRules(item.externalId)) continue;
        try {
          const derivedId = idOf("recurringRule", item.externalId);
          // A schedule imported earlier is already here; it is not new, and re-validating it
          // against today's vault could reject something the user has since edited.
          if (liveRules.some((entity) => entity.id === derivedId)) continue;
          // A schedule the user deleted stays deleted in merge mode.
          if (!replacing && stored.recurringRules.has(derivedId)) continue;
          const accountId = resolveAccount(item.accountExternalId);
          const categoryId = item.categoryExternalId
            ? resolveCategory(item.categoryExternalId)
            : null;
          const normalized = validateRecurring(ctx, {
            template: {
              kind: item.kind,
              title: item.title,
              note: item.note,
              accountId,
              categoryId,
              tagIds: resolveTags(item.tagExternalIds),
              amountMinor: item.amountMinor,
              currency: item.currency,
            },
            unit: item.unit,
            interval: item.interval,
            startDate: item.startDate,
            endDate: item.endDate,
            nextDueDate: item.nextDueDate,
            autoPost: item.autoPost,
            active: item.active,
          });
          const dependencyArchived =
            archivedAccountIds.has(accountId) ||
            Boolean(categoryId && archivedCategoryIds.has(categoryId));
          newRules.push(
            createEntity({
              id: derivedId,
              ...normalized,
              active: item.active && !dependencyArchived,
              pausedByDependency: item.active && dependencyArchived,
            }) as RecurringRule,
          );
        } catch (error) {
          reject(item.externalId, reasonOf(error));
        }
      }
    },
  );
  return newRules;
}

export function importTransactions(
  run: ImportRun,
  bundle: ImportBundle,
  entities: ImportedEntities,
  resolvers: Resolvers,
  existingKeys: ReadonlySet<string>,
) {
  const {
    ctx,
    host,
    replacing,
    idOf,
    outcome,
    reject,
    firstSighting,
    stored,
    archivedVaultAccounts,
    archivedVaultCategories,
    replacingLedger,
  } = run;
  const { buildAccounts, buildCategories, buildTags } = entities;
  const { resolveAccount, resolveCategory, resolveTags } = resolvers;
  const bundleRuleIds = new Set(
    bundle.recurringRules.map((item) => item.externalId),
  );
  const newTransactions: TransactionRecord[] = [];

  const seenTransactions = firstSighting("transaction");
  // Occurrences the vault already has an answer for, live or tombstoned. The generator makes an
  // upcoming occurrence for a due schedule on its own, and a user may have skipped or deleted
  // one, so an imported upcoming entry for the same schedule and date must not add a second.
  const storedOccurrenceKeys = new Set<string>();
  for (const record of stored.transactions.values()) {
    if (record.occurrenceKey) storedOccurrenceKeys.add(record.occurrenceKey);
  }
  host.withProspectiveState(
    {
      accounts: buildAccounts,
      categories: buildCategories,
      tags: buildTags,
      ...replacingLedger,
    },
    () => {
      for (const item of bundle.transactions) {
        if (!seenTransactions(item.externalId)) continue;
        const derivedId = idOf("transaction", item.externalId);
        // Live or tombstoned: either way the vault already has an answer for this record. The
        // tombstone case is the user's deliberate deletion, which an import must not undo.
        if (!replacing && stored.transactions.has(derivedId)) {
          outcome.duplicateTransactions += 1;
          continue;
        }
        // An upcoming entry that belongs to a schedule is that schedule's waiting occurrence, so
        // it carries the key the generator uses for it (`<rule id>:<date>`).
        const occurrenceRuleId =
          item.status === "upcoming" && item.recurringRuleExternalId !== null
            ? idOf("recurringRule", item.recurringRuleExternalId)
            : null;
        const occurrenceKey = occurrenceRuleId
          ? `${occurrenceRuleId}:${item.localDate}`
          : null;
        if (
          !replacing &&
          occurrenceRuleId &&
          occurrenceKey &&
          (storedOccurrenceKeys.has(occurrenceKey) ||
            stored.recurringRules.get(occurrenceRuleId)?.deletedAt)
        ) {
          // Either the occurrence already exists, or the user deleted the schedule: an import
          // must not bring back an entry for something they removed.
          outcome.duplicateTransactions += 1;
          continue;
        }
        try {
          const accountId = resolveAccount(item.accountExternalId);
          if (archivedVaultAccounts.has(accountId))
            throw new Error("Its account is archived in this vault.");
          const isTransfer = item.kind === "transfer";
          const destinationAccountId =
            isTransfer && item.destinationAccountExternalId !== null
              ? resolveAccount(item.destinationAccountExternalId)
              : null;
          if (
            destinationAccountId &&
            archivedVaultAccounts.has(destinationAccountId)
          ) {
            throw new Error(
              "Its destination account is archived in this vault.",
            );
          }
          const categoryId =
            !isTransfer && item.categoryExternalId !== null
              ? resolveCategory(item.categoryExternalId)
              : null;
          if (categoryId && archivedVaultCategories.has(categoryId)) {
            throw new Error("Its category is archived in this vault.");
          }
          const resolvedTagIds = resolveTags(item.tagExternalIds);
          if (
            item.recurringRuleExternalId !== null &&
            !bundleRuleIds.has(item.recurringRuleExternalId)
          ) {
            throw new Error(
              "It belongs to a schedule that is not in the backup.",
            );
          }
          // Rate resolution stays inside `buildTransaction`: a missing rate for the date throws
          // here and becomes a per-record rejection rather than aborting the preview.
          const built = host.buildTransaction(
            {
              kind: item.kind,
              status: item.status,
              title: item.title,
              note: item.note,
              localDate: item.localDate,
              accountId,
              destinationAccountId,
              categoryId,
              tagIds: resolvedTagIds,
              amountMinor: item.amountMinor,
              destinationAmountMinor: isTransfer
                ? item.destinationAmountMinor
                : null,
              recurringRuleId:
                item.recurringRuleExternalId === null
                  ? null
                  : idOf("recurringRule", item.recurringRuleExternalId),
              occurrenceKey,
            },
            undefined,
            [],
            undefined,
            derivedId,
          );
          // `buildTransaction` mints a random group id for a transfer; derive it instead so
          // two devices importing the same file agree on it.
          const transaction =
            built.kind === "transfer"
              ? {
                  ...built,
                  transferGroupId: idOf("transfer-group", item.externalId),
                }
              : built;
          if (!replacing) {
            const tagNames = resolvedTagIds.map(
              (id) => buildTags.find((tag) => tag.id === id)?.name ?? id,
            );
            if (
              existingKeys.has(
                transactionDuplicateKey(ctx, transaction, tagNames),
              )
            ) {
              outcome.duplicateTransactions += 1;
              continue;
            }
          }
          newTransactions.push(transaction);
        } catch (error) {
          reject(item.externalId, reasonOf(error));
        }
      }
    },
  );
  return newTransactions;
}

export function importBudgets(
  run: ImportRun,
  bundle: ImportBundle,
  entities: ImportedEntities,
  resolvers: Resolvers,
) {
  const {
    ctx,
    host,
    replacing,
    idOf,
    reject,
    firstSighting,
    liveBudgets,
    stored,
  } = run;
  const { buildAccounts, buildCategories, buildTags } = entities;
  const { resolveAccount, resolveCategory, resolveTags } = resolvers;
  const newBudgets: Budget[] = [];

  const seenBudgets = firstSighting("budget");
  host.withProspectiveState(
    {
      accounts: buildAccounts,
      categories: buildCategories,
      tags: buildTags,
    },
    () => {
      for (const item of bundle.budgets) {
        if (!seenBudgets(item.externalId)) continue;
        try {
          const derivedId = idOf("budget", item.externalId);
          if (liveBudgets.some((entity) => entity.id === derivedId)) continue;
          // A budget the user deleted stays deleted in merge mode.
          if (!replacing && stored.budgets.has(derivedId)) continue;
          const normalized = validateBudget(ctx, {
            name: item.name,
            icon: item.icon,
            color: item.color,
            limitMinor: item.limitMinor,
            period: { ...item.period },
            // An imported budget starts a fresh history here; there is no earlier Qashy period
            // to carry an unspent balance out of.
            rollover: false,
            filters: {
              accountIds: item.accountExternalIds.map(resolveAccount),
              categoryIds: item.categoryExternalIds.map(resolveCategory),
              tagIds: resolveTags(item.tagExternalIds),
            },
            categoryLimits: item.categoryLimits.map((limit) => ({
              categoryId: resolveCategory(limit.categoryExternalId),
              limitMinor: limit.limitMinor,
            })),
            archived: false,
          });
          newBudgets.push(
            createEntity({ id: derivedId, ...normalized }) as Budget,
          );
        } catch (error) {
          reject(item.externalId, reasonOf(error));
        }
      }
    },
  );
  return newBudgets;
}
