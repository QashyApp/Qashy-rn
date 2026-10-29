import type { TransactionRecord } from "@/domain/models";
import {
  dayNetMinor,
  totalsWithoutHidden,
} from "@/features/transactions/list/summary";

function makeTransaction(
  overrides: Partial<TransactionRecord>,
): TransactionRecord {
  return {
    id: "id",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    kind: "expense",
    status: "posted",
    title: "Transaction",
    note: "",
    localDate: "2026-01-01",
    accountId: "account-1",
    destinationAccountId: null,
    categoryId: null,
    tagIds: [],
    amountMinor: 0,
    destinationAmountMinor: null,
    destinationBaseAmountMinor: null,
    currency: "USD",
    destinationCurrency: null,
    exchangeRate: "1",
    baseAmountMinor: 0,
    transferGroupId: null,
    recurringRuleId: null,
    occurrenceKey: null,
    ...overrides,
  };
}

describe("dayNetMinor", () => {
  it("adds income and subtracts expense, both in base-currency minor units", () => {
    const net = dayNetMinor([
      makeTransaction({ kind: "income", baseAmountMinor: 5000 }),
      makeTransaction({ kind: "expense", baseAmountMinor: 1200 }),
    ]);
    expect(net).toBe(3800);
  });

  it("excludes transfers, which never count as income or expense", () => {
    const net = dayNetMinor([
      makeTransaction({ kind: "income", baseAmountMinor: 1000 }),
      makeTransaction({ kind: "transfer", baseAmountMinor: 99999 }),
    ]);
    expect(net).toBe(1000);
  });

  it("totals mixed-currency transactions through their snapshotted base amount", () => {
    // amountMinor stays in the transaction's own currency; baseAmountMinor is
    // what actually gets summed, so a day mixing EUR and USD still totals
    // correctly in the base currency.
    const net = dayNetMinor([
      makeTransaction({
        kind: "income",
        currency: "EUR",
        amountMinor: 900,
        baseAmountMinor: 1000,
      }),
      makeTransaction({
        kind: "expense",
        currency: "USD",
        amountMinor: 400,
        baseAmountMinor: 400,
      }),
    ]);
    expect(net).toBe(600);
  });

  it("returns 0 for an empty day", () => {
    expect(dayNetMinor([])).toBe(0);
  });

  it("includes upcoming transactions, matching whatever the caller passes in", () => {
    const net = dayNetMinor([
      makeTransaction({
        kind: "expense",
        status: "upcoming",
        baseAmountMinor: 250,
      }),
    ]);
    expect(net).toBe(-250);
  });
});

describe("totalsWithoutHidden", () => {
  const totals = { incomeMinor: 10000, expenseMinor: 4000, netFlowMinor: 6000 };
  const range = ["2026-01-01", "2026-01-31"] as const;
  const rows = [
    makeTransaction({
      id: "spend",
      kind: "expense",
      baseAmountMinor: 1500,
      localDate: "2026-01-10",
    }),
    makeTransaction({
      id: "pay",
      kind: "income",
      baseAmountMinor: 2500,
      localDate: "2026-01-12",
    }),
    makeTransaction({
      id: "move",
      kind: "transfer",
      baseAmountMinor: 9999,
      localDate: "2026-01-12",
    }),
  ];

  it("returns the totals untouched when nothing is hidden", () => {
    expect(totalsWithoutHidden(totals, rows, new Set(), ...range)).toBe(totals);
  });

  it("takes a hidden expense out of spending and adds it back to the net", () => {
    expect(
      totalsWithoutHidden(totals, rows, new Set(["spend"]), ...range),
    ).toEqual({ incomeMinor: 10000, expenseMinor: 2500, netFlowMinor: 7500 });
  });

  it("takes a hidden income out of income and the net", () => {
    expect(
      totalsWithoutHidden(totals, rows, new Set(["pay"]), ...range),
    ).toEqual({ incomeMinor: 7500, expenseMinor: 4000, netFlowMinor: 3500 });
  });

  it("handles several hidden rows at once, in minor units", () => {
    expect(
      totalsWithoutHidden(totals, rows, new Set(["spend", "pay"]), ...range),
    ).toEqual({ incomeMinor: 7500, expenseMinor: 2500, netFlowMinor: 5000 });
  });

  it("ignores a hidden transfer, which the totals never counted", () => {
    expect(totalsWithoutHidden(totals, rows, new Set(["move"]), ...range)).toBe(
      totals,
    );
  });

  it("ignores rows the aggregate does not count", () => {
    const uncounted = [
      makeTransaction({
        id: "upcoming",
        status: "upcoming",
        baseAmountMinor: 700,
        localDate: "2026-01-20",
      }),
      makeTransaction({
        id: "unpriced",
        baseAmountMinor: null,
        localDate: "2026-01-20",
      }),
      makeTransaction({
        id: "other-month",
        baseAmountMinor: 700,
        localDate: "2026-02-01",
      }),
      makeTransaction({
        id: "deleted",
        baseAmountMinor: 700,
        localDate: "2026-01-20",
        deletedAt: "2026-01-21T00:00:00.000Z",
      }),
    ];
    const hidden = new Set(uncounted.map((item) => item.id));
    expect(totalsWithoutHidden(totals, uncounted, hidden, ...range)).toBe(
      totals,
    );
  });

  it("counts the first and last day of the range", () => {
    const edges = [
      makeTransaction({
        id: "first",
        baseAmountMinor: 100,
        localDate: "2026-01-01",
      }),
      makeTransaction({
        id: "last",
        baseAmountMinor: 200,
        localDate: "2026-01-31",
      }),
    ];
    expect(
      totalsWithoutHidden(totals, edges, new Set(["first", "last"]), ...range)
        .expenseMinor,
    ).toBe(3700);
  });

  it("stays exact where floating point would drift", () => {
    const big = { incomeMinor: 0, expenseMinor: 300, netFlowMinor: -300 };
    const tiny = [
      makeTransaction({
        id: "a",
        baseAmountMinor: 10,
        localDate: "2026-01-02",
      }),
      makeTransaction({
        id: "b",
        baseAmountMinor: 20,
        localDate: "2026-01-02",
      }),
    ];
    expect(
      totalsWithoutHidden(big, tiny, new Set(["a", "b"]), ...range),
    ).toEqual({ incomeMinor: 0, expenseMinor: 270, netFlowMinor: -270 });
  });
});
