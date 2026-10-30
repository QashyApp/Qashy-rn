import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { RecurringInput } from "@/data/repository";
import { projectedNextDueDate } from "@/features/more/recurring/recurring-model";
import { nextDueDateOnReactivation } from "@/utils/recurring-impact";

/**
 * Pausing a schedule means the dates it was paused through are skipped: switching it back on moves
 * its stale next due date to the first occurrence on or after today instead of backfilling (and,
 * for auto-post, posting) every one it missed.
 */

const at = (iso: string) => jest.setSystemTime(new Date(`${iso}T09:00:00Z`));

async function createRepository() {
  const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
  await repository.initialize();
  await repository.completeOnboarding({
    locale: "en-US",
    baseCurrency: "USD",
    accountName: "Everyday",
    accountType: "checking",
    openingBalanceMinor: 100_000,
    themeMode: "system",
    accentSource: "system",
    accentHex: "#5966E9",
  });
  return repository;
}

function ruleInput(
  repository: LocalFinanceRepository,
  overrides: Partial<RecurringInput> = {},
): RecurringInput {
  return {
    template: {
      kind: "expense",
      title: "Gym",
      note: "",
      accountId: repository.getSnapshot().accounts[0].id,
      categoryId: null,
      tagIds: [],
      amountMinor: 2_500,
      currency: "USD",
    },
    unit: "week",
    interval: 1,
    startDate: "2026-06-03",
    endDate: null,
    nextDueDate: "2026-06-03",
    autoPost: true,
    active: true,
    ...overrides,
  };
}

const occurrencesOf = (repository: LocalFinanceRepository, ruleId: string) =>
  repository
    .getSnapshot()
    .transactions.filter((item) => item.recurringRuleId === ruleId)
    .map((item) => item.localDate)
    .sort();

describe("nextDueDateOnReactivation", () => {
  const rule = {
    unit: "month" as const,
    interval: 1,
    startDate: "2026-01-10",
    nextDueDate: "2026-03-10",
  };

  it("moves a stale date to the first occurrence on or after today", () => {
    expect(nextDueDateOnReactivation(rule, "2026-06-15")).toBe("2026-07-10");
    expect(nextDueDateOnReactivation(rule, "2026-06-10")).toBe("2026-06-10");
  });

  it("keeps a date that is today or later", () => {
    expect(nextDueDateOnReactivation(rule, "2026-03-10")).toBe("2026-03-10");
    expect(nextDueDateOnReactivation(rule, "2026-02-01")).toBe("2026-03-10");
  });
});

describe("reactivating a paused schedule", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-08");
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function pausedRule(repository: LocalFinanceRepository) {
    const rule = await repository.saveRecurringRule(ruleInput(repository));
    // A start in the past does not backfill: the schedule begins at Jun 10.
    expect(rule.nextDueDate).toBe("2026-06-10");
    expect(occurrencesOf(repository, rule.id)).toEqual([]);
    return repository.saveRecurringRule(
      ruleInput(repository, {
        nextDueDate: rule.nextDueDate,
        active: false,
      }),
      rule.id,
      rule.revision,
    );
  }

  it("skips the dates missed while paused instead of backfilling them", async () => {
    const repository = await createRepository();
    const paused = await pausedRule(repository);
    expect(paused.active).toBe(false);
    expect(paused.nextDueDate).toBe("2026-06-10");

    // A paused rule generates nothing, however long it sits.
    at("2026-07-20");
    await repository.generateRecurring("2026-07-20");
    expect(occurrencesOf(repository, paused.id)).toEqual([]);

    const resumed = await repository.saveRecurringRule(
      ruleInput(repository, {
        nextDueDate: paused.nextDueDate,
        active: true,
      }),
      paused.id,
      paused.revision,
    );
    // Jul 20 is a Monday: the weekly series (Wednesdays) resumes on Jul 22.
    expect(resumed.active).toBe(true);
    expect(resumed.nextDueDate).toBe("2026-07-22");
    // Nothing for Jun 10 ... Jul 15, and switching auto-post back on posted nothing old.
    expect(occurrencesOf(repository, paused.id)).toEqual([]);

    // The schedule carries on from there, keyed as ever.
    at("2026-07-23");
    await repository.generateRecurring("2026-07-23");
    expect(occurrencesOf(repository, paused.id)).toEqual(["2026-07-22"]);
    const keys = repository
      .getSnapshot()
      .transactions.filter((item) => item.recurringRuleId === paused.id)
      .map((item) => item.occurrenceKey);
    expect(new Set(keys).size).toBe(keys.length);
    await repository.generateRecurring("2026-07-23");
    expect(occurrencesOf(repository, paused.id)).toHaveLength(1);
  });

  it("keeps a next due date that is still ahead", async () => {
    const repository = await createRepository();
    const paused = await pausedRule(repository);
    // Resumed the same day it was paused: Jun 10 is still ahead.
    const resumed = await repository.saveRecurringRule(
      ruleInput(repository, {
        nextDueDate: paused.nextDueDate,
        active: true,
      }),
      paused.id,
      paused.revision,
    );
    expect(resumed.nextDueDate).toBe("2026-06-10");
  });

  it("leaves a long-expired paused schedule with nothing left to generate", async () => {
    const repository = await createRepository();
    const rule = await repository.saveRecurringRule(
      ruleInput(repository, {
        endDate: "2026-06-20",
        autoPost: false,
      }),
    );
    const paused = await repository.saveRecurringRule(
      ruleInput(repository, {
        endDate: "2026-06-20",
        autoPost: false,
        nextDueDate: rule.nextDueDate,
        active: false,
      }),
      rule.id,
      rule.revision,
    );
    at("2026-09-01");
    const resumed = await repository.saveRecurringRule(
      ruleInput(repository, {
        endDate: "2026-06-20",
        autoPost: false,
        nextDueDate: paused.nextDueDate,
        active: true,
      }),
      paused.id,
      paused.revision,
    );
    // Past its end date, so generation ends it again without creating anything.
    expect(resumed.nextDueDate > "2026-06-20").toBe(true);
    await repository.generateRecurring("2026-09-01");
    expect(
      repository.getSnapshot().recurringRules.find((r) => r.id === rule.id)!
        .active,
    ).toBe(false);
    expect(occurrencesOf(repository, rule.id)).toEqual([]);
  });

  it("keeps the stored date of a schedule edited while paused instead of jumping past today", async () => {
    // Monthly on the 10th, ending Mar 31, paused with Mar 10 still ahead of its end.
    at("2026-01-12");
    const repository = await createRepository();
    const rule = await repository.saveRecurringRule(
      ruleInput(repository, {
        unit: "month",
        startDate: "2026-01-10",
        nextDueDate: "2026-01-10",
        endDate: "2026-03-31",
        autoPost: false,
      }),
    );
    expect(rule.nextDueDate).toBe("2026-02-10");
    const paused = await repository.saveRecurringRule(
      ruleInput(repository, {
        unit: "month",
        startDate: "2026-01-10",
        endDate: "2026-03-31",
        autoPost: false,
        nextDueDate: rule.nextDueDate,
        active: false,
      }),
      rule.id,
      rule.revision,
    );

    // Months later, the interval changes while it stays paused.
    at("2026-10-30");
    const edited = await repository.saveRecurringRule(
      ruleInput(repository, {
        unit: "month",
        interval: 2,
        startDate: "2026-01-10",
        endDate: "2026-03-31",
        autoPost: false,
        nextDueDate: paused.nextDueDate,
        active: false,
      }),
      paused.id,
      paused.revision,
    );
    // The paused rule's next date did not jump to the first occurrence after today.
    expect(edited.active).toBe(false);
    expect(edited.nextDueDate).toBe("2026-03-10");
    expect(occurrencesOf(repository, rule.id)).toEqual([]);
    // The form's projection of the stored date agrees with what the save stored. (The form judges
    // "ended" by the date resuming would give, as the schedule list does: Nov 10, past Mar 31.)
    expect(
      projectedNextDueDate({
        existing: paused,
        active: false,
        unit: "month",
        interval: 2,
        startDate: "2026-01-10",
        endDate: "2026-03-31",
        today: "2026-10-30",
      }),
    ).toBe(edited.nextDueDate);
  });
});

describe("pausing a schedule in the same save as a change", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-08");
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("drops the old pending items and leaves one sensible date", async () => {
    const repository = await createRepository();
    const created = await repository.saveRecurringRule(
      ruleInput(repository, { autoPost: false }),
    );
    at("2026-06-24");
    await repository.generateRecurring("2026-06-24");
    const live = () =>
      repository
        .getSnapshot()
        .transactions.filter(
          (item) => item.recurringRuleId === created.id && !item.deletedAt,
        );
    expect(live().map((item) => item.localDate)).toEqual([
      "2026-06-10",
      "2026-06-17",
      "2026-06-24",
    ]);
    const current = repository
      .getSnapshot()
      .recurringRules.find((item) => item.id === created.id)!;
    const paused = await repository.saveRecurringRule(
      ruleInput(repository, {
        autoPost: false,
        interval: 2,
        nextDueDate: current.nextDueDate,
        active: false,
      }),
      current.id,
      current.revision,
    );
    // Every-other-Wednesday from Jun 3, restarted where the discarded items began: Jun 17.
    expect(paused.active).toBe(false);
    expect(paused.nextDueDate).toBe("2026-06-17");
    expect(live()).toEqual([]);
    expect(
      projectedNextDueDate({
        existing: current,
        active: false,
        unit: "week",
        interval: 2,
        startDate: "2026-06-03",
        endDate: null,
        earliestPendingDate: "2026-06-10",
        today: "2026-06-24",
      }),
    ).toBe(paused.nextDueDate);

    // Paused rules generate nothing, so nothing stale or duplicated appears meanwhile.
    at("2026-07-20");
    await repository.generateRecurring("2026-07-20");
    expect(live()).toEqual([]);
    const keys = repository
      .getSnapshot()
      .transactions.filter((item) => item.recurringRuleId === created.id)
      .map((item) => item.occurrenceKey)
      .filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("resuming a paused schedule in the same save as other edits", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("2026-06-08");
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const liveDates = (repository: LocalFinanceRepository, ruleId: string) =>
    repository
      .getSnapshot()
      .transactions.filter(
        (item) => item.recurringRuleId === ruleId && !item.deletedAt,
      )
      .map((item) => item.localDate)
      .sort();

  /** A weekly review-first schedule with three upcoming occurrences, then paused. */
  async function pausedWithPending(repository: LocalFinanceRepository) {
    const created = await repository.saveRecurringRule(
      ruleInput(repository, { autoPost: false }),
    );
    at("2026-06-24");
    await repository.generateRecurring("2026-06-24");
    expect(liveDates(repository, created.id)).toEqual([
      "2026-06-10",
      "2026-06-17",
      "2026-06-24",
    ]);
    const current = repository
      .getSnapshot()
      .recurringRules.find((item) => item.id === created.id)!;
    return repository.saveRecurringRule(
      ruleInput(repository, {
        autoPost: false,
        nextDueDate: current.nextDueDate,
        active: false,
      }),
      current.id,
      current.revision,
    );
  }

  it("does not recreate the dates between the old pending items and today", async () => {
    const repository = await createRepository();
    const paused = await pausedWithPending(repository);
    at("2026-07-20");
    const resumed = await repository.saveRecurringRule(
      ruleInput(repository, {
        autoPost: false,
        // The schedule changes in the same save.
        endDate: "2026-12-30",
        nextDueDate: paused.nextDueDate,
        active: true,
      }),
      paused.id,
      paused.revision,
    );
    // Jul 20 is a Monday: the Wednesday series resumes on Jul 22, not back at Jun 10.
    expect(resumed.nextDueDate).toBe("2026-07-22");
    // The pending items from before the pause are discarded, not regenerated.
    expect(liveDates(repository, paused.id)).toEqual([]);
    at("2026-07-22");
    await repository.generateRecurring("2026-07-22");
    expect(liveDates(repository, paused.id)).toEqual(["2026-07-22"]);
  });

  it("does not backfill when the start date moves earlier as it resumes", async () => {
    const repository = await createRepository();
    const paused = await pausedWithPending(repository);
    at("2026-07-20");
    const resumed = await repository.saveRecurringRule(
      ruleInput(repository, {
        autoPost: false,
        startDate: "2026-05-06",
        nextDueDate: paused.nextDueDate,
        active: true,
      }),
      paused.id,
      paused.revision,
    );
    expect(resumed.nextDueDate).toBe("2026-07-22");
    expect(liveDates(repository, paused.id)).toEqual([]);
  });

  it("does not rewind into the pause for a pending item that cannot be priced", async () => {
    const repository = await createRepository();
    const paused = await pausedWithPending(repository);
    at("2026-07-20");
    const accountId = repository.getSnapshot().accounts[0].id;
    // A template change to a foreign amount with no stored rate leaves the old pending items
    // unpriced: they are discarded, and the rule is not wound back to them.
    const resumed = await repository.saveRecurringRule(
      ruleInput(repository, {
        autoPost: false,
        template: {
          kind: "expense",
          title: "Gym",
          note: "",
          accountId,
          categoryId: null,
          tagIds: [],
          amountMinor: 2_500,
          currency: "USD",
          foreign: { amountMinor: 2_500, currency: "EUR" },
        },
        nextDueDate: paused.nextDueDate,
        active: true,
      }),
      paused.id,
      paused.revision,
    );
    expect(resumed.nextDueDate).toBe("2026-07-22");
    expect(liveDates(repository, paused.id)).toEqual([]);
  });
});
