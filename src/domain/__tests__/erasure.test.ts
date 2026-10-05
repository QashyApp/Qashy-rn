import { eraseEntity, eraseField, isErasable } from "@/domain/erasure";
import type {
  Account,
  Budget,
  RecurringRule,
  TransactionRecord,
} from "@/domain/models";

const DELETED = "2026-05-05T00:00:00.000Z";
const BASE = {
  revision: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-05-05T00:00:00.000Z",
};

const transaction: TransactionRecord = {
  ...BASE,
  id: "txn-1",
  deletedAt: DELETED,
  kind: "expense",
  status: "posted",
  title: "Pharmacy",
  note: "Prescription",
  localDate: "2026-05-01",
  accountId: "acc-1",
  destinationAccountId: null,
  categoryId: "cat-1",
  tagIds: ["tag-1"],
  amountMinor: 4_250,
  destinationAmountMinor: null,
  destinationBaseAmountMinor: null,
  currency: "USD",
  destinationCurrency: null,
  exchangeRate: "1",
  baseAmountMinor: 4_250,
  transferGroupId: null,
  recurringRuleId: "rule-1",
  occurrenceKey: "rule-1:2026-05-01",
  foreign: null,
  fee: null,
};

describe("eraseEntity", () => {
  it("returns a live record untouched", () => {
    const live = { ...transaction, deletedAt: null };
    expect(eraseEntity("transactions", live)).toBe(live);
  });

  it("keeps a deleted transaction's identity and suppression key, and nothing it described", () => {
    const erased = eraseEntity("transactions", transaction);
    expect(erased).toMatchObject({
      id: "txn-1",
      deletedAt: DELETED,
      revision: 3,
      kind: "expense",
      status: "posted",
      occurrenceKey: "rule-1:2026-05-01",
      title: "",
      note: "",
      localDate: "",
      accountId: "",
      categoryId: null,
      tagIds: [],
      amountMinor: 0,
      baseAmountMinor: 0,
      recurringRuleId: null,
    });
    const text = JSON.stringify(erased);
    for (const secret of [
      "Pharmacy",
      "Prescription",
      "4250",
      "acc-1",
      "cat-1",
      "tag-1",
    ])
      expect(text).not.toContain(secret);
  });

  it("keeps what an account needs to come back, and erases its name and balance", () => {
    const account: Account = {
      ...BASE,
      id: "acc-1",
      deletedAt: DELETED,
      name: "Joint savings",
      type: "savings",
      currency: "EUR",
      openingBalanceMinor: 120_000,
      icon: "wallet",
      color: "#5966E9",
      archived: true,
    };
    expect(eraseEntity("accounts", account)).toEqual({
      ...BASE,
      id: "acc-1",
      deletedAt: DELETED,
      name: "",
      type: "savings",
      currency: "EUR",
      openingBalanceMinor: 0,
      icon: "wallet",
      color: "#5966E9",
      archived: false,
    });
  });

  it("erases inside nested values but keeps their shape", () => {
    const budget = {
      ...BASE,
      id: "bud-1",
      deletedAt: DELETED,
      name: "Groceries",
      icon: "cart",
      color: "#5F9F78",
      limitMinor: 50_000,
      period: {
        unit: "month",
        interval: 1,
        anchorDate: "2026-01-01",
        endDate: null,
      },
      rollover: true,
      filters: { accountIds: ["acc-1"], categoryIds: ["cat-1"], tagIds: [] },
      categoryLimits: [{ categoryId: "cat-1", limitMinor: 1_000 }],
      archived: false,
    } as Budget;
    expect(eraseEntity("budgets", budget)).toMatchObject({
      name: "",
      limitMinor: 0,
      period: { unit: "month", interval: 1, anchorDate: "", endDate: null },
      filters: { accountIds: [], categoryIds: [], tagIds: [] },
      categoryLimits: [],
    });

    const rule = {
      ...BASE,
      id: "rule-1",
      deletedAt: DELETED,
      template: {
        kind: "expense",
        title: "Rent",
        note: "Flat 4",
        accountId: "acc-1",
        categoryId: "cat-1",
        tagIds: ["tag-1"],
        amountMinor: 150_000,
        currency: "USD",
        foreign: null,
        fee: null,
      },
      unit: "month",
      interval: 1,
      startDate: "2026-01-01",
      endDate: null,
      nextDueDate: "2026-06-01",
      autoPost: true,
      active: true,
      pausedByDependency: false,
    } as RecurringRule;
    const erasedRule = eraseEntity("recurringRules", rule);
    expect(erasedRule.template).toMatchObject({
      kind: "expense",
      title: "",
      amountMinor: 0,
    });
    expect(JSON.stringify(erasedRule)).not.toContain("Rent");
    expect(JSON.stringify(erasedRule)).not.toContain("2026-06-01");
  });

  it("drops a field this build does not know rather than keeping it", () => {
    const fromNewerBuild = { ...transaction, merchant: "Corner shop" };
    const erased = eraseEntity(
      "transactions",
      fromNewerBuild,
    ) as unknown as Record<string, unknown>;
    expect("merchant" in erased).toBe(false);
    expect(eraseField("transactions", "merchant", "Corner shop")).toBeNull();
  });

  it("is idempotent", () => {
    const once = eraseEntity("transactions", transaction);
    expect(eraseEntity("transactions", once)).toEqual(once);
  });

  it("never erases settings", () => {
    expect(isErasable("settings")).toBe(false);
    expect(isErasable("transactions")).toBe(true);
  });
});
