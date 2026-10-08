/**
 * Duplicate review — the human half of merging two already-populated vaults.
 *
 * The deterministic repair pass *renames* colliding records so the merged set stays valid; it
 * cannot decide whether two categories called "Bakery" are the same category. These tests
 * cover the part that can: what gets suggested, what is refused outright, and — the assertion
 * that matters most — that confirming a merge leaves nothing in the vault still pointing at
 * the record that was merged away.
 *
 * Everything runs through the real repository over the real sync engine, because the failure
 * being guarded against is not "the planner returned the wrong array". It is a transaction, a
 * budget filter, or a closed period snapshot quietly holding a tombstoned id that only
 * surfaces weeks later as a total that stopped adding up.
 *
 * Collisions cannot be manufactured on one device — `assertUniqueName` rejects them — so every
 * test here partitions two devices, creates the same thing on each, and heals. That is not
 * scaffolding standing in for the real thing; it *is* the real thing, and it is the situation
 * this whole module exists for.
 */

import type {
  Account,
  Budget,
  BudgetPeriodSnapshot,
  Category,
  FinanceEntity,
  FinanceState,
} from "@/domain/models";
import {
  account as accountFixture,
  budget as budgetFixture,
  category as categoryFixture,
} from "@/sync/oplog/__tests__/helpers";
import {
  BASE_CURRENCY,
  expectConverged,
  makeVault,
  onboard,
  settle,
  sync,
  type VaultDevice,
} from "@/sync/engine/__tests__/vault";
import {
  planMerge,
  suggestDuplicates,
  type DuplicateGroup,
} from "@/sync/engine/duplicates";
import { addRecurrence, startOfMonth, todayLocal } from "@/utils/date";

const TODAY = todayLocal();
const PERIOD_START = startOfMonth(TODAY);
/**
 * Far enough out that saving a rule does not immediately post it.
 *
 * `saveRecurringRule` generates through today plus a month on the spot, and a posted
 * occurrence would be one more transaction the reference sweep below has to account for.
 */
const DUE = addRecurrence(TODAY, "year", 1);

const live = <T extends FinanceEntity>(rows: readonly T[]) =>
  rows.filter((row) => !row.deletedAt);

const groupFor = (device: VaultDevice, kind: DuplicateGroup["kind"]) =>
  suggestDuplicates(device.state).find((group) => group.kind === kind);

const account = (device: VaultDevice, name: string) =>
  live(device.state.accounts).find((row) => row.name === name);

/** One device onboards, the other receives the vault — pairing a new phone with an old one. */
async function paired() {
  const devices = await makeVault({ count: 2 });
  await onboard(devices[0]);
  await sync(devices, 3);
  return devices;
}

/** Cuts the link, runs `work` on each device in isolation, then heals and re-converges. */
async function apart(
  devices: readonly VaultDevice[],
  work: (device: VaultDevice, index: number) => Promise<unknown>,
) {
  const wire = devices[0].wireTo(devices[1]);
  wire.partition();
  for (const [index, device] of devices.entries()) await work(device, index);
  wire.heal();
  await settle();
  await sync(devices, 3);
}

const savings = (device: VaultDevice, currency = BASE_CURRENCY) =>
  device.repository.saveAccount({
    name: "Savings",
    type: "savings",
    currency,
    openingBalanceMinor: 0,
    icon: "wallet",
    color: "#5966E9",
    archived: false,
  });

const bakery = (device: VaultDevice, kind: "expense" | "income" = "expense") =>
  device.repository.saveCategory({
    name: "Bakery",
    kind,
    icon: "cart",
    color: "#5F9F78",
    parentId: null,
    archived: false,
  });

const urgent = (device: VaultDevice) =>
  device.repository.saveTag({ name: "Urgent", color: "#E16B75" });

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

describe("duplicate suggestions", () => {
  it("pairs records the rename pass pushed apart", async () => {
    const devices = await paired();
    await apart(devices, (device) => bakery(device));

    // The repair renamed one of them, which is what keeps the merged vault saveable — and it
    // is also what makes exact-name matching useless here. Stripping the suffix is the only
    // reason these two ever find each other again.
    const names = live(devices[0].state.categories)
      .map((row) => row.name)
      .filter((name) => name.toLowerCase().startsWith("bakery"))
      .sort();
    expect(names).toEqual(["Bakery", "Bakery (duplicate)"]);

    const group = groupFor(devices[0], "categories")!;
    expect(group.mergeIds).toHaveLength(1);
    expect(group.blocked).toBeNull();
    // The survivor is the one that kept the clean name. Merging the other way would rename a
    // category out from under the user for no reason they could see.
    expect(
      devices[0].state.categories.find((row) => row.id === group.keepId)?.name,
    ).toBe("Bakery");

    // And both devices propose the same merge, so it does not matter which one is in hand.
    expect(groupFor(devices[1], "categories")).toEqual(group);
  });

  it("refuses same-named accounts held in different currencies", async () => {
    const devices = await paired();
    await devices[0].repository.saveExchangeRate({
      fromCurrency: "EUR",
      toCurrency: BASE_CURRENCY,
      rate: "1.10",
      effectiveDate: PERIOD_START,
    });
    await sync(devices, 3);
    await apart(devices, (device, index) =>
      savings(device, index === 0 ? BASE_CURRENCY : "EUR"),
    );

    // Not a conflict to resolve. Every transaction snapshots the rate it was converted at
    // *against its account's currency*, so merging these would leave one account holding rows
    // denominated in two currencies — and the currency repair would then rewrite the account
    // to match whichever transaction it saw first, silently changing what its balance means.
    const group = groupFor(devices[0], "accounts")!;
    expect(group.blocked).toContain("different currencies");
    expect(() => planMerge(devices[0].state, [group])).toThrow(
      "different currencies",
    );
  });

  it("refuses accounts a transfer moves money between", async () => {
    const devices = await paired();
    await apart(devices, (device) => savings(device));
    const group = groupFor(devices[0], "accounts")!;
    await devices[0].repository.saveTransaction({
      kind: "transfer",
      title: "Move",
      localDate: TODAY,
      accountId: group.keepId,
      destinationAccountId: group.mergeIds[0],
      amountMinor: 5_000,
    });

    // A transfer between two accounts that became one account is a transfer to itself, which
    // `validateTransaction` rejects — so the merged vault would be *unwritable*, not merely
    // wrong. The user moved money between these, so they are demonstrably not one account.
    expect(groupFor(devices[0], "accounts")!.blocked).toContain("transfer");
  });

  it("refuses categories that track different kinds of money", async () => {
    const devices = await paired();
    await apart(devices, (device, index) =>
      bakery(device, index === 0 ? "expense" : "income"),
    );
    expect(groupFor(devices[0], "categories")!.blocked).toContain(
      "different kinds",
    );
  });

  it("finds duplicate transactions only once their accounts are one record", async () => {
    const devices = await paired();
    await apart(devices, (device) => savings(device));
    const accounts = groupFor(devices[0], "accounts")!;
    await apart(devices, (device, index) =>
      device.repository.saveTransaction({
        kind: "expense",
        title: "Deposit fee",
        localDate: TODAY,
        accountId: index === 0 ? accounts.keepId : accounts.mergeIds[0],
        amountMinor: 250,
      }),
    );

    // Same date, same title, same amount — but booked against two accounts that are still two
    // entities, and a transaction on a different account is a different transaction. This is
    // why the review screen has to present accounts before transactions rather than listing
    // everything at once: the second list does not exist until the first one is acted on.
    expect(groupFor(devices[0], "transactions")).toBeUndefined();

    await devices[0].repository.mergeDuplicates([accounts]);
    const merged = groupFor(devices[0], "transactions")!;
    expect(merged.mergeIds).toHaveLength(1);
    expect(merged.label).toBe("Deposit fee");
  });
});

// ---------------------------------------------------------------------------
// Applying a merge
// ---------------------------------------------------------------------------

describe("merging duplicates", () => {
  it("retargets every reference and leaves nothing pointing at the merged record", async () => {
    const devices = await paired();
    const [alice, bob] = devices;
    const everyday = account(alice, "Everyday")!.id;

    // Two devices, offline, each inventing the same three records and the same transaction —
    // which is what pairing a phone and a laptop that were both already in use looks like on
    // the day it happens.
    await apart(devices, async (device) => {
      await savings(device);
      await bakery(device);
      await urgent(device);
      await device.repository.saveTransaction({
        kind: "expense",
        title: "Coffee",
        localDate: TODAY,
        accountId: everyday,
        amountMinor: 450,
      });
    });

    const found = suggestDuplicates(alice.state);
    expect(found.map((group) => group.kind).sort()).toEqual([
      "accounts",
      "categories",
      "tags",
      "transactions",
    ]);
    const doomed = new Map(
      found.map((group) => [group.kind, group.mergeIds[0]]),
    );
    const lostAccount = doomed.get("accounts")!;
    const lostCategory = doomed.get("categories")!;
    const lostTag = doomed.get("tags")!;
    const lostTransaction = doomed.get("transactions")!;

    // Now hang one of every reference type in the schema off the records that are about to be
    // merged away. Anything this misses is a field the merge can silently leave dangling.
    await alice.repository.saveTransaction({
      kind: "expense",
      title: "Croissant",
      localDate: TODAY,
      accountId: lostAccount,
      categoryId: lostCategory,
      tagIds: [lostTag],
      amountMinor: 700,
    });
    await alice.repository.saveTransaction({
      kind: "transfer",
      title: "Top up",
      localDate: TODAY,
      accountId: everyday,
      destinationAccountId: lostAccount,
      amountMinor: 2_000,
    });
    await alice.repository.saveRecurringRule({
      template: {
        kind: "expense",
        title: "Weekly loaf",
        note: "",
        accountId: lostAccount,
        categoryId: lostCategory,
        tagIds: [lostTag],
        amountMinor: 600,
        currency: BASE_CURRENCY,
      },
      unit: "month",
      interval: 1,
      startDate: DUE,
      endDate: null,
      nextDueDate: DUE,
      autoPost: false,
      active: true,
    });
    await alice.repository.saveBudget({
      name: "Bakery run",
      icon: "chart",
      color: "#5966E9",
      limitMinor: 5_000,
      period: {
        unit: "month",
        interval: 1,
        anchorDate: PERIOD_START,
        endDate: null,
      },
      rollover: false,
      filters: {
        accountIds: [lostAccount],
        categoryIds: [lostCategory],
        tagIds: [lostTag],
      },
      categoryLimits: [{ categoryId: lostCategory, limitMinor: 1_000 }],
      archived: false,
    });
    await alice.repository.saveCategory({
      name: "Sourdough",
      kind: "expense",
      icon: "cart",
      color: "#5F9F78",
      parentId: lostCategory,
      archived: false,
    });
    await alice.repository.saveGoal({
      name: "Cut bakery spend",
      kind: "spending",
      icon: "target",
      color: "#5966E9",
      targetMinor: 10_000,
      initialMinor: 0,
      targetDate: null,
      linkedAccountId: lostAccount,
      linkedCategoryId: lostCategory,
      archived: false,
    });
    const goal = await alice.repository.saveGoal({
      name: "Rainy day",
      kind: "saving",
      icon: "target",
      color: "#5966E9",
      targetMinor: 50_000,
      initialMinor: 0,
      targetDate: null,
      linkedAccountId: null,
      linkedCategoryId: null,
      archived: false,
    });
    await alice.repository.saveContribution({
      goalId: goal.id,
      amountMinor: 1_000,
      localDate: TODAY,
      transactionId: lostTransaction,
      note: "",
    });

    await sync(devices, 3);
    const beforeSpend = alice.repository.getBudgetStatuses(TODAY)[0].spentMinor;
    expect(beforeSpend).toBe(700);
    expect(
      alice.state.budgetPeriods.some((row) =>
        row.filters.accountIds.includes(lostAccount),
      ),
    ).toBe(true);

    const result = await alice.repository.mergeDuplicates(
      suggestDuplicates(alice.state),
    );
    expect(result.merged).toBe(4);
    expect(result.retargeted).toBeGreaterThan(0);

    // Nothing anywhere still names a merged-away record. Written as a sweep over the whole
    // reference graph rather than field-by-field assertions, so a *new* reference field added
    // to the schema and forgotten in `planMerge` fails here instead of shipping.
    const gone = new Set([lostAccount, lostCategory, lostTag, lostTransaction]);
    const state = alice.state;
    const references: string[] = [];
    for (const row of live(state.transactions)) {
      references.push(row.accountId, ...row.tagIds);
      if (row.destinationAccountId) references.push(row.destinationAccountId);
      if (row.categoryId) references.push(row.categoryId);
    }
    for (const row of live(state.categories))
      if (row.parentId) references.push(row.parentId);
    for (const row of live(state.recurringRules)) {
      references.push(row.template.accountId, ...row.template.tagIds);
      if (row.template.categoryId) references.push(row.template.categoryId);
    }
    const scoped: (Budget | BudgetPeriodSnapshot)[] = [
      ...live(state.budgets),
      ...live(state.budgetPeriods),
    ];
    for (const row of scoped) {
      references.push(
        ...row.filters.accountIds,
        ...row.filters.categoryIds,
        ...row.filters.tagIds,
      );
      references.push(...row.categoryLimits.map((limit) => limit.categoryId));
    }
    for (const row of live(state.goals)) {
      if (row.linkedAccountId) references.push(row.linkedAccountId);
      if (row.linkedCategoryId) references.push(row.linkedCategoryId);
    }
    for (const row of live(state.contributions)) {
      if (row.transactionId) references.push(row.transactionId);
    }
    expect(references.filter((id) => gone.has(id))).toEqual([]);

    // A closed period's filters are history, but they are not inert: `getBudgetStatuses`
    // re-runs `budgetSpend` over them to show what was spent back then, so leaving a
    // merged-away account id in there would have quietly dropped those rows from the total.
    expect(alice.repository.getBudgetStatuses(TODAY)[0].spentMinor).toBe(
      beforeSpend,
    );

    // The vault is still writable, which is the assertion a deep-equality check cannot make:
    // a merged set can be perfectly converged and still reject every future save.
    expect(suggestDuplicates(alice.state)).toEqual([]);
    const budget = live(alice.state.budgets)[0];
    await expect(
      alice.repository.saveBudget(
        {
          name: budget.name,
          icon: budget.icon,
          color: budget.color,
          limitMinor: budget.limitMinor,
          period: budget.period,
          rollover: budget.rollover,
          filters: budget.filters,
          categoryLimits: budget.categoryLimits,
          archived: false,
        },
        budget.id,
      ),
    ).resolves.toBeDefined();

    // And it propagates as ordinary history: no new op kind, nothing the receiving device has
    // to understand specially.
    await sync(devices, 3);
    expectConverged(devices);
    expect(
      live(bob.state.accounts)
        .map((row) => row.name)
        .sort(),
    ).toEqual(["Everyday", "Savings"]);
    expect(bob.state.accounts.some((row) => row.id === lostAccount)).toBe(
      false,
    );
  });

  it("keeps the tags a transaction picked up from both sides, once each", async () => {
    const devices = await paired();
    await apart(devices, (device) => urgent(device));
    const tags = groupFor(devices[0], "tags")!;
    const transaction = await devices[0].repository.saveTransaction({
      kind: "expense",
      title: "Plumber",
      localDate: TODAY,
      accountId: account(devices[0], "Everyday")!.id,
      amountMinor: 12_000,
      tagIds: [tags.keepId, tags.mergeIds[0]],
    });

    await devices[0].repository.mergeDuplicates([tags]);

    // Two devices that each tagged the same expense "Urgent" leave one transaction carrying
    // both ids. Retargeting without deduping would write the survivor twice, which every
    // count and every filter downstream reads as two tags.
    const merged = devices[0].state.transactions.find(
      (row) => row.id === transaction.id,
    )!;
    expect(merged.tagIds).toEqual([tags.keepId]);
  });

  it("cuts a parent link rather than pointing a category at itself", async () => {
    const devices = await paired();
    await apart(devices, (device) => bakery(device));
    const categories = groupFor(devices[0], "categories")!;
    const child = await devices[0].repository.saveCategory({
      name: "Sourdough",
      kind: "expense",
      icon: "cart",
      color: "#5F9F78",
      parentId: categories.mergeIds[0],
      archived: false,
    });

    await devices[0].repository.mergeDuplicates([categories]);
    expect(
      devices[0].state.categories.find((row) => row.id === child.id)?.parentId,
    ).toBe(categories.keepId);

    // The degenerate direction: merging a parent into its own child would leave
    // `parentId === id`, which the hierarchy repair then has to undo on every device that
    // receives it. Cutting the link means that state is never authored in the first place.
    const plan = planMerge(devices[0].state, [
      {
        kind: "categories",
        keepId: child.id,
        mergeIds: [categories.keepId],
        label: "Sourdough",
        blocked: null,
      },
    ]);
    const patched = plan.records.find(
      (record) => record.type === "categories" && record.entity.id === child.id,
    );
    expect((patched?.entity as Category | undefined)?.parentId).toBeNull();
  });

  it("refuses a chain of merges rather than resolving it silently", async () => {
    const [alice] = await paired();
    const first = await alice.repository.saveTag({
      name: "Alpha",
      color: "#E16B75",
    });
    const second = await alice.repository.saveTag({
      name: "Beta",
      color: "#E16B75",
    });
    const third = await alice.repository.saveTag({
      name: "Gamma",
      color: "#E16B75",
    });

    // "Alpha into Beta" and "Alpha into Gamma" confirmed together. Picking one would merge two
    // things the user never put in the same group; applying both would leave a live reference
    // pointing at a tombstone.
    expect(() =>
      planMerge(alice.state, [
        {
          kind: "tags",
          keepId: second.id,
          mergeIds: [first.id],
          label: "Beta",
          blocked: null,
        },
        {
          kind: "tags",
          keepId: third.id,
          mergeIds: [first.id],
          label: "Gamma",
          blocked: null,
        },
      ]),
    ).toThrow("already being merged");
  });

  it("writes nothing when a confirmed record was deleted in the meantime", async () => {
    const devices = await paired();
    await apart(devices, (device) => urgent(device));
    const tags = groupFor(devices[0], "tags")!;
    await devices[0].repository.deleteEntities("tags", [tags.mergeIds[0]]);
    const before = live(devices[0].state.tags).map((row) => row.id);

    // The review screen holds a snapshot; the vault does not stop moving while it is open. A
    // merge planned against a record that is already gone has to refuse whole rather than
    // apply the half of it that still resolves.
    await expect(devices[0].repository.mergeDuplicates([tags])).rejects.toThrow(
      "no longer exists",
    );
    expect(live(devices[0].state.tags).map((row) => row.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Merge rules that do not need two devices: what a confirmed group does to the numbers and the
// references, checked on hand-built state so each rule is the only thing that varies.
// ---------------------------------------------------------------------------

const stateWith = (over: Partial<FinanceState>): FinanceState =>
  ({
    ready: true,
    settings: null,
    accounts: [],
    categories: [],
    tags: [],
    transactions: [],
    budgets: [],
    budgetPeriods: [],
    budgetAdjustments: [],
    goals: [],
    contributions: [],
    recurringRules: [],
    exchangeRates: [],
    ...over,
  }) as unknown as FinanceState;

const group = (
  kind: DuplicateGroup["kind"],
  keepId: string,
  mergeIds: string[],
): DuplicateGroup => ({ kind, keepId, mergeIds, label: keepId, blocked: null });

const recordOf = (
  records: ReturnType<typeof planMerge>["records"],
  id: string,
) => records.find((record) => record.entity.id === id);

describe("merge rules on hand-built state", () => {
  describe("opening balances", () => {
    it("adds the copies' opening balances onto the account kept", () => {
      const state = stateWith({
        accounts: [
          accountFixture({
            id: "acc-keep",
            name: "Cash",
            openingBalanceMinor: 1_000,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          accountFixture({
            id: "acc-copy",
            name: "Cash",
            openingBalanceMinor: 250,
            createdAt: "2026-01-02T00:00:00.000Z",
          }),
        ],
      });
      const [suggested] = suggestDuplicates(state);
      expect(suggested).toMatchObject({
        keepId: "acc-keep",
        mergeIds: ["acc-copy"],
        blocked: null,
        combinesOpeningBalances: true,
      });

      const plan = planMerge(state, [suggested]);
      expect(
        (recordOf(plan.records, "acc-keep")!.entity as Account)
          .openingBalanceMinor,
      ).toBe(1_250);
      expect(recordOf(plan.records, "acc-copy")!.entity.deletedAt).toBeTruthy();
    });

    it("says nothing about balances when the copies all start at zero", () => {
      const state = stateWith({
        accounts: [
          accountFixture({
            id: "acc-keep",
            name: "Cash",
            openingBalanceMinor: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          accountFixture({
            id: "acc-copy",
            name: "Cash",
            openingBalanceMinor: 0,
            createdAt: "2026-01-02T00:00:00.000Z",
          }),
        ],
      });
      const [suggested] = suggestDuplicates(state);
      expect(suggested.combinesOpeningBalances).toBeFalsy();
      // Nothing to add, so the kept account is not rewritten at all.
      expect(
        recordOf(planMerge(state, [suggested]).records, "acc-keep"),
      ).toBeUndefined();
    });

    it("blocks the merge rather than overflowing the safe range", () => {
      const huge = 9_000_000_000_000_000;
      const state = stateWith({
        accounts: [
          accountFixture({
            id: "acc-keep",
            name: "Cash",
            openingBalanceMinor: huge,
          }),
          accountFixture({
            id: "acc-copy",
            name: "Cash",
            openingBalanceMinor: huge,
          }),
        ],
      });
      const [suggested] = suggestDuplicates(state);
      expect(suggested.blocked).toMatch(/outside the supported range/);
      expect(() => planMerge(state, [suggested])).toThrow(
        /outside the supported range/,
      );
    });
  });

  describe("chained merges", () => {
    const state = stateWith({
      accounts: [
        accountFixture({ id: "acc-a", name: "A" }),
        accountFixture({ id: "acc-b", name: "B" }),
        accountFixture({ id: "acc-c", name: "C" }),
      ],
    });
    const keepA = group("accounts", "acc-a", ["acc-b"]);
    const keepB = group("accounts", "acc-b", ["acc-c"]);

    it("refuses a record that one group keeps and another merges away, in either order", () => {
      expect(() => planMerge(state, [keepA, keepB])).toThrow(
        "already being merged into another",
      );
      expect(() => planMerge(state, [keepB, keepA])).toThrow(
        "already being merged into another",
      );
    });
  });

  describe("per-category budget limits", () => {
    it("keeps the surviving category's own limit when two limits collapse", () => {
      const state = stateWith({
        categories: [
          categoryFixture({ id: "cat-keep", name: "Food" }),
          categoryFixture({ id: "cat-copy", name: "Food" }),
        ],
        budgets: [
          budgetFixture({
            id: "bud-1",
            categoryLimits: [
              { categoryId: "cat-copy", limitMinor: 500 },
              { categoryId: "cat-keep", limitMinor: 900 },
            ],
          }),
        ],
      });
      const plan = planMerge(state, [
        group("categories", "cat-keep", ["cat-copy"]),
      ]);
      expect(
        (recordOf(plan.records, "bud-1")!.entity as Budget).categoryLimits,
      ).toEqual([{ categoryId: "cat-keep", limitMinor: 900 }]);
    });

    it("falls back to the loser whose id sorts first when the survivor has no limit", () => {
      const state = stateWith({
        categories: [
          categoryFixture({ id: "cat-keep", name: "Food" }),
          categoryFixture({ id: "cat-z", name: "Food old" }),
          categoryFixture({ id: "cat-y", name: "Food older" }),
        ],
        budgets: [
          budgetFixture({
            id: "bud-1",
            categoryLimits: [
              { categoryId: "cat-z", limitMinor: 300 },
              { categoryId: "cat-y", limitMinor: 200 },
            ],
          }),
        ],
      });
      const plan = planMerge(state, [
        group("categories", "cat-keep", ["cat-z", "cat-y"]),
      ]);
      expect(
        (recordOf(plan.records, "bud-1")!.entity as Budget).categoryLimits,
      ).toEqual([{ categoryId: "cat-keep", limitMinor: 200 }]);
    });
  });
});
