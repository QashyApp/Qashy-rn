import type { FinanceContext } from "@/data/finance/context";
import {
  MissingExchangeRateError,
  postedWithSnapshot,
  resolveRate,
} from "@/data/finance/rates";
import { active, applyTransactionChanges } from "@/data/finance/records";
import { assertTransactionSetSafe } from "@/data/finance/safety";
import type { BuildTransaction } from "@/data/finance/transactions";
import {
  assertDate,
  assertExpectedRevision,
  assertIdsExist,
  assertPositiveMinor,
  CATEGORY_KINDS,
  findExisting,
  normalizeCurrency,
  normalizeRate,
  RECURRENCE_UNITS,
} from "@/data/finance/validation";
import type { RecurringRule, TransactionRecord } from "@/domain/models";
import type { RecurringInput } from "@/data/repository";
import {
  addRecurrence,
  firstRecurrenceOnOrAfter,
  todayLocal,
} from "@/utils/date";
import { createEntity, makeId, nowIso, updateEntity } from "@/utils/entity";
import { convertMinor } from "@/utils/money";
import { normalizeFeePercent } from "@/utils/transaction-amounts";

const MAX_RECURRING_OCCURRENCES_PER_RUN = 100_000;

/**
 * What the recurring rules need from the repository beyond its snapshot: the transaction builder
 * (reached through the repository so it stays the one place a transaction is validated) and the
 * keys of occurrences the user deleted, which generation must not bring back.
 */
export interface RecurringDeps {
  buildTransaction: BuildTransaction;
  deletedOccurrenceKeys: ReadonlySet<string>;
}

/**
 * Engine-raised bugs (a wrong type, an undefined reference, malformed code) as opposed to the
 * domain errors the repository and money helpers throw deliberately.
 */
function isProgrammingError(reason: Error) {
  return (
    reason instanceof TypeError ||
    reason instanceof ReferenceError ||
    reason instanceof SyntaxError
  );
}

/**
 * Visits each due date of `rule` from its `nextDueDate` up to `horizonDate` (and its end date),
 * and returns the first date not visited. Throws if the schedule stalls or has too many
 * occurrences to walk in one run.
 */
export function walkRecurrence(
  rule: RecurringRule,
  horizonDate: string,
  visit: (dueDate: string) => void,
) {
  let due = rule.nextDueDate;
  let guard = 0;
  while (due <= horizonDate && guard < MAX_RECURRING_OCCURRENCES_PER_RUN) {
    guard += 1;
    if (rule.endDate && due > rule.endDate) break;
    visit(due);
    const nextDue = addRecurrence(
      due,
      rule.unit,
      Math.max(1, rule.interval),
      rule.startDate,
    );
    if (nextDue <= due) throw new Error("Recurring schedule did not advance.");
    due = nextDue;
  }
  if (guard >= MAX_RECURRING_OCCURRENCES_PER_RUN && due <= horizonDate) {
    throw new Error(
      "Recurring schedule has too many occurrences to generate in one run.",
    );
  }
  return due;
}

/**
 * What a generation run for `horizonDate` would write for the recurring schedules, without
 * writing it: the transactions it would create or post, and the rules it would advance. Reads
 * `ctx.state` and changes nothing, so a run commits it and a read-only preview only looks at it.
 * `virtualIds` gives new transactions an id derived from their occurrence key instead of a
 * random one, so a preview is deterministic.
 */
export function planRecurring(
  ctx: FinanceContext,
  deps: RecurringDeps,
  horizonDate: string,
  today: string,
  options: { onlyRuleId?: string; virtualIds?: boolean } = {},
) {
  const { onlyRuleId, virtualIds = false } = options;
  let generated = 0;
  const transactions = [...ctx.state.transactions];
  const occurrenceKeys = new Set<string>();
  for (const item of transactions)
    if (item.occurrenceKey) occurrenceKeys.add(item.occurrenceKey);
  const transactionChanges: TransactionRecord[] = [];
  const ruleChanges: RecurringRule[] = [];
  for (const rule of active(ctx.state.recurringRules).filter(
    (item) => item.active && (!onlyRuleId || item.id === onlyRuleId),
  )) {
    // A rule that can no longer build its transaction (dangling reference,
    // missing exchange rate) is skipped so one bad rule never blocks the
    // other rules or app startup, which awaits this generation.
    try {
      if (rule.autoPost) {
        transactions.forEach((transaction, index) => {
          if (
            transaction.recurringRuleId === rule.id &&
            transaction.status === "upcoming" &&
            transaction.localDate <= today
          ) {
            // Auto-posting an unpriced occurrence snapshots today's rate, as confirming it would.
            // With no rate yet it stays upcoming and is retried on the next pass.
            const updated = postedWithSnapshot(ctx, transaction, today);
            if (!updated) return;
            transactions[index] = updated;
            transactionChanges.push(updated);
          }
        });
      }
      const due = walkRecurrence(rule, horizonDate, (occurrenceDate) => {
        const occurrenceKey = `${rule.id}:${occurrenceDate}`;
        if (
          deps.deletedOccurrenceKeys.has(occurrenceKey) ||
          occurrenceKeys.has(occurrenceKey)
        )
          return;
        const transaction = deps.buildTransaction(
          {
            ...rule.template,
            localDate: occurrenceDate,
            status:
              rule.autoPost && occurrenceDate <= today ? "posted" : "upcoming",
            recurringRuleId: rule.id,
            occurrenceKey,
          },
          undefined,
          [],
          undefined,
          virtualIds ? `pending:${occurrenceKey}` : undefined,
        );
        transactions.push(transaction);
        occurrenceKeys.add(occurrenceKey);
        transactionChanges.push(transaction);
        generated += 1;
      });
      const active = !rule.endDate || due <= rule.endDate;
      if (due !== rule.nextDueDate || active !== rule.active) {
        ruleChanges.push(updateEntity(rule, { nextDueDate: due, active }));
      }
    } catch (reason) {
      // A missing exchange rate is transient: rates may simply not have
      // loaded yet, and nothing would ever resume a rule paused for it. Leave
      // the rule active and untouched so the next generation pass retries.
      if (reason instanceof MissingExchangeRateError) continue;
      // A programming error is not a property of the rule. Rethrow it so it surfaces
      // rather than silently pausing every rule that happens to reach the same line.
      if (!(reason instanceof Error) || isProgrammingError(reason))
        throw reason;
      // Any other domain failure (dangling reference, invalid schedule) will not fix
      // itself. Pause the rule so it surfaces as "Paused" in the Recurring
      // list and the user can fix the cause and re-enable it.
      if (rule.active)
        ruleChanges.push(
          updateEntity(rule, { active: false, pausedByDependency: false }),
        );
      continue;
    }
  }
  return { transactions, transactionChanges, ruleChanges, generated };
}

export function assertRecurringRuleGenerationSafe(
  ctx: FinanceContext,
  deps: RecurringDeps,
  rule: RecurringRule,
  currentTransactions: TransactionRecord[],
  horizonDate: string,
) {
  if (!rule.active) return;
  const today = todayLocal();
  // Simulates generation's auto-post: an occurrence is priced as it would be when posted, and one
  // with no rate yet stays upcoming exactly as `generateRecurringNow` leaves it.
  const transactions = currentTransactions.map(
    (transaction) =>
      (rule.autoPost &&
        transaction.recurringRuleId === rule.id &&
        transaction.status === "upcoming" &&
        transaction.localDate <= today &&
        postedWithSnapshot(ctx, transaction, today)) ||
      transaction,
  );
  try {
    walkRecurrence(rule, horizonDate, (occurrenceDate) => {
      const occurrenceKey = `${rule.id}:${occurrenceDate}`;
      if (
        deps.deletedOccurrenceKeys.has(occurrenceKey) ||
        transactions.some(
          (transaction) => transaction.occurrenceKey === occurrenceKey,
        )
      )
        return;
      transactions.push(
        deps.buildTransaction({
          ...rule.template,
          localDate: occurrenceDate,
          status:
            rule.autoPost && occurrenceDate <= today ? "posted" : "upcoming",
          recurringRuleId: rule.id,
          occurrenceKey,
        }),
      );
    });
  } catch (reason) {
    // Generation leaves a rule untouched while a rate it needs is missing (see `planRecurring`),
    // so nothing past this occurrence would be written either: check what was built before it.
    if (!(reason instanceof MissingExchangeRateError)) throw reason;
  }
  assertTransactionSetSafe(ctx, transactions);
}

export function validateRecurring(
  ctx: FinanceContext,
  input: RecurringInput,
  id?: string,
): RecurringInput {
  const existing = findExisting(ctx.state.recurringRules, id, "recurring rule");
  if (!CATEGORY_KINDS.includes(input.template.kind))
    throw new Error("Choose a valid recurring transaction kind.");
  if (!RECURRENCE_UNITS.includes(input.unit))
    throw new Error("Choose a valid recurrence period.");
  if (!input.template.foreign)
    assertPositiveMinor(input.template.amountMinor, "Recurring amount");
  assertDate(input.startDate);
  assertDate(input.nextDueDate);
  if (input.endDate) {
    assertDate(input.endDate);
    if (input.endDate < input.startDate)
      throw new Error("Schedule end date must not precede its start date.");
  }
  if (!Number.isSafeInteger(input.interval) || input.interval < 1)
    throw new Error("Repeat interval must be a positive whole number.");
  const account = ctx.state.accounts.find(
    (item) => item.id === input.template.accountId,
  );
  if (
    !account ||
    (account.archived && existing?.template.accountId !== account.id)
  ) {
    throw new Error("Choose a valid account.");
  }
  if (normalizeCurrency(input.template.currency) !== account.currency) {
    throw new Error("Recurring currency must match its account.");
  }
  // No rate is required to save a rule: an occurrence without one stays upcoming until it is paid.
  if (input.template.categoryId) {
    const category = ctx.state.categories.find(
      (item) => item.id === input.template.categoryId,
    );
    if (
      !category ||
      category.kind !== input.template.kind ||
      (category.archived && existing?.template.categoryId !== category.id)
    ) {
      throw new Error(`Choose a valid ${input.template.kind} category.`);
    }
  }
  assertIdsExist(input.template.tagIds, ctx.state.tags, "tag");
  // `amountMinor` on the returned template is a display estimate only —
  // real occurrences are priced through `buildTransaction`, which derives
  // the principal from `foreign` (and resolves its own rate per occurrence
  // date when the template carries none) rather than trusting this number.
  let estimatedAmountMinor = input.template.amountMinor;
  let normalizedForeign: RecurringInput["template"]["foreign"] = null;
  if (input.template.foreign) {
    const foreignCurrency = normalizeCurrency(input.template.foreign.currency);
    if (foreignCurrency === account.currency) {
      throw new Error(
        "Choose a foreign currency different from the account’s.",
      );
    }
    assertPositiveMinor(input.template.foreign.amountMinor, "Amount");
    // No rate is required to save: with none typed and none stored, the rule is saved with the
    // typed amount as its display estimate, and each occurrence waits until a rate exists.
    let foreignRate: string | null = null;
    if (input.template.foreign.exchangeRate) {
      foreignRate = normalizeRate(input.template.foreign.exchangeRate);
    } else {
      try {
        foreignRate = resolveRate(
          ctx,
          foreignCurrency,
          account.currency,
          input.nextDueDate,
        );
      } catch (reason) {
        if (!(reason instanceof MissingExchangeRateError)) throw reason;
      }
    }
    if (foreignRate) {
      estimatedAmountMinor = convertMinor(
        input.template.foreign.amountMinor,
        foreignCurrency,
        account.currency,
        foreignRate,
        ctx.formatLocale,
      );
    } else if (
      !Number.isSafeInteger(estimatedAmountMinor) ||
      estimatedAmountMinor <= 0
    ) {
      estimatedAmountMinor = input.template.foreign.amountMinor;
    }
    normalizedForeign = {
      amountMinor: input.template.foreign.amountMinor,
      currency: foreignCurrency,
      // Keep an explicit rate only if the caller supplied one. A template
      // with none resolves its own rate at each occurrence's date.
      ...(input.template.foreign.exchangeRate && foreignRate
        ? { exchangeRate: foreignRate }
        : {}),
    };
  }
  let normalizedFee: RecurringInput["template"]["fee"] = null;
  if (input.template.fee) {
    if (input.template.fee.kind === "fixed") {
      assertPositiveMinor(input.template.fee.amountMinor, "Fee");
      normalizedFee = {
        kind: "fixed",
        amountMinor: input.template.fee.amountMinor,
      };
    } else {
      normalizedFee = {
        kind: "percent",
        percent: normalizeFeePercent(input.template.fee.percent),
      };
    }
  }
  const referencesArchivedEntity =
    account.archived ||
    Boolean(
      input.template.categoryId &&
      ctx.state.categories.find((item) => item.id === input.template.categoryId)
        ?.archived,
    );
  return {
    ...input,
    active: input.active && !referencesArchivedEntity,
    interval: Math.floor(input.interval),
    template: {
      ...input.template,
      title: input.template.title.trim() || "Recurring transaction",
      note: input.template.note.trim(),
      currency: account.currency,
      tagIds: [...new Set(input.template.tagIds)],
      amountMinor: estimatedAmountMinor,
      foreign: normalizedForeign,
      fee: normalizedFee,
    },
  };
}

/**
 * Everything saving a recurring rule changes before anything is written: the validated rule and,
 * when its schedule or template changed, the pending occurrences it discards or rebuilds. Throws
 * if the result would break an invariant, so a failure leaves nothing to undo.
 */
export function planRecurringRuleSave(
  ctx: FinanceContext,
  deps: RecurringDeps,
  input: RecurringInput,
  id?: string,
  expectedRevision?: number,
) {
  const existing = findExisting(ctx.state.recurringRules, id, "recurring rule");
  assertExpectedRevision(existing, input, expectedRevision);
  const scheduleChanged =
    !!existing &&
    (existing.unit !== input.unit ||
      existing.interval !== input.interval ||
      existing.startDate !== input.startDate ||
      existing.endDate !== input.endDate);
  const templateChanged =
    !!existing &&
    (existing.template.kind !== input.template.kind ||
      existing.template.title !== input.template.title ||
      existing.template.note !== input.template.note ||
      existing.template.accountId !== input.template.accountId ||
      existing.template.categoryId !== input.template.categoryId ||
      existing.template.amountMinor !== input.template.amountMinor ||
      existing.template.currency !== input.template.currency ||
      JSON.stringify(existing.template.tagIds) !==
        JSON.stringify(input.template.tagIds) ||
      JSON.stringify(existing.template.foreign ?? null) !==
        JSON.stringify(input.template.foreign ?? null) ||
      JSON.stringify(existing.template.fee ?? null) !==
        JSON.stringify(input.template.fee ?? null));
  const currentUpcoming = existing
    ? ctx.state.transactions.filter(
        (transaction) =>
          transaction.recurringRuleId === existing.id &&
          transaction.status === "upcoming",
      )
    : [];
  const earliestUpcomingDate = currentUpcoming
    .map((transaction) => transaction.localDate)
    .sort()[0];
  // Regeneration restarts where the discarded pending items began. Flooring at today dropped
  // every overdue occurrence for good (their keys are released, nothing regenerates them). With
  // nothing pending it restarts from the rule's next due date, never earlier than today, so an
  // edit still cannot backfill history.
  const baseRegenerateFrom =
    earliestUpcomingDate ??
    [existing?.nextDueDate ?? input.startDate, todayLocal()].sort().at(-1)!;
  // Moving the start date earlier is an explicit request to include the missed occurrences, so
  // regeneration begins at the new start; occurrence keys keep already-generated ones from duplicating.
  const movedEarlier = !!existing && input.startDate < existing.startDate;
  const regenerateFrom =
    movedEarlier && input.startDate < baseRegenerateFrom
      ? input.startDate
      : baseRegenerateFrom;
  const nextInput = scheduleChanged
    ? {
        ...input,
        nextDueDate: firstRecurrenceOnOrAfter(
          input.startDate,
          input.unit,
          input.interval,
          [input.startDate, regenerateFrom].sort().at(-1)!,
        ),
      }
    : input;
  const validated = validateRecurring(ctx, nextInput, id);
  // A NEW rule starts at its first occurrence on or after today: a start date in the past must
  // not backfill every missed occurrence (edits are handled above and never backfill either).
  const normalized = existing
    ? validated
    : {
        ...validated,
        nextDueDate: firstRecurrenceOnOrAfter(
          validated.startDate,
          validated.unit,
          validated.interval,
          [validated.startDate, todayLocal()].sort().at(-1)!,
        ),
      };
  // The flag means "off because a dependency is archived", and it is what lets unarchiving bring
  // the rule back. The form reopens a paused rule with `active: false`, so the input cannot say
  // whether the user switched it off: keep the flag while its account or category is still
  // archived, and clear it once nothing archived blocks the rule.
  const dependencyArchived =
    Boolean(
      ctx.state.accounts.find(
        (item) => item.id === normalized.template.accountId,
      )?.archived,
    ) ||
    Boolean(
      normalized.template.categoryId &&
      ctx.state.categories.find(
        (item) => item.id === normalized.template.categoryId,
      )?.archived,
    );
  const pausedByDependency = Boolean(
    existing?.pausedByDependency && dependencyArchived,
  );
  const ruleId = existing?.id ?? makeId();
  // A pending occurrence that cannot be priced for the new template (a foreign amount with no rate
  // stored yet) is discarded and its key released, like a schedule change does; the rule is wound
  // back to the earliest one so it is generated again once a rate exists.
  const unpriced: string[] = [];
  const discardPending = (transaction: TransactionRecord) =>
    updateEntity(transaction, { deletedAt: nowIso(), occurrenceKey: null });
  const transactionChanges = scheduleChanged
    ? currentUpcoming.map(discardPending)
    : templateChanged
      ? currentUpcoming.map((transaction) => {
          try {
            return deps.buildTransaction(
              {
                ...normalized.template,
                localDate: transaction.localDate,
                status: transaction.status,
                exchangeRate:
                  transaction.accountId === normalized.template.accountId
                    ? (transaction.exchangeRate ?? undefined)
                    : undefined,
                recurringRuleId: ruleId,
                occurrenceKey: transaction.occurrenceKey,
              },
              transaction.id,
            );
          } catch (reason) {
            if (!(reason instanceof MissingExchangeRateError)) throw reason;
            unpriced.push(transaction.localDate);
            return discardPending(transaction);
          }
        })
      : [];
  const rewindTo = unpriced.sort()[0];
  const rewound =
    rewindTo && rewindTo < normalized.nextDueDate
      ? { ...normalized, nextDueDate: rewindTo }
      : normalized;
  const rule = existing
    ? updateEntity(existing, { ...rewound, pausedByDependency })
    : (createEntity({
        id: ruleId,
        ...rewound,
        pausedByDependency: false,
      }) as RecurringRule);
  assertRecurringRuleGenerationSafe(
    ctx,
    deps,
    rule,
    applyTransactionChanges(ctx.state.transactions, transactionChanges),
    todayLocal(),
  );
  return { rule, transactionChanges };
}
