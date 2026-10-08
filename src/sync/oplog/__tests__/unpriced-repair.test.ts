/**
 * A transaction is posted with a rate snapshot, or it is unpriced (`null` snapshot) while it is
 * still upcoming. A concurrent edit can merge a posted status with another device's unpriced
 * snapshot. Repair must return such a row to upcoming, deterministically and without emitting ops.
 */

import {
  repairMergedState,
  type RepairInput,
  type RepairOutput,
} from "@/sync/oplog/repair";
import { transaction } from "@/sync/oplog/__tests__/helpers";

const input = (over: Partial<RepairInput> = {}): RepairInput => ({
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
});

const find = (output: RepairOutput, id: string) =>
  output.transactions.find((item) => item.id === id)!;

describe("unpriced transactions", () => {
  it("returns a posted row without a rate snapshot to upcoming", () => {
    const output = repairMergedState(
      input({
        transactions: [
          transaction({
            id: "tx-unpriced",
            status: "posted",
            exchangeRate: null,
            baseAmountMinor: null,
          }),
        ],
      }),
    );
    expect(find(output, "tx-unpriced")).toMatchObject({
      status: "upcoming",
      exchangeRate: null,
      baseAmountMinor: null,
    });
    expect(output.notes.map((note) => note.code)).toContain("unpricedPosted");
    expect(output.changed.map((record) => record.entity.id)).toEqual([
      "tx-unpriced",
    ]);
  });

  it("returns a posted transfer whose destination leg is unpriced to upcoming", () => {
    const output = repairMergedState(
      input({
        transactions: [
          transaction({
            id: "tx-transfer",
            kind: "transfer",
            status: "posted",
            accountId: "acc-1",
            destinationAccountId: "acc-2",
            destinationAmountMinor: 900,
            destinationBaseAmountMinor: null,
            destinationCurrency: "EUR",
            exchangeRate: "1",
            baseAmountMinor: 1000,
          }),
        ],
      }),
    );
    expect(find(output, "tx-transfer").status).toBe("upcoming");
  });

  it("leaves a posted row with its snapshot alone", () => {
    const output = repairMergedState(
      input({
        transactions: [transaction({ id: "tx-priced", status: "posted" })],
      }),
    );
    expect(find(output, "tx-priced").status).toBe("posted");
    expect(output.notes.map((note) => note.code)).not.toContain(
      "unpricedPosted",
    );
    expect(output.changed).toEqual([]);
  });

  it("leaves an upcoming or skipped unpriced row untouched", () => {
    const output = repairMergedState(
      input({
        transactions: [
          transaction({
            id: "tx-upcoming",
            status: "upcoming",
            exchangeRate: null,
            baseAmountMinor: null,
          }),
          transaction({
            id: "tx-skipped",
            status: "skipped",
            exchangeRate: null,
            baseAmountMinor: null,
          }),
        ],
      }),
    );
    expect(find(output, "tx-upcoming").status).toBe("upcoming");
    expect(find(output, "tx-skipped").status).toBe("skipped");
    expect(output.changed).toEqual([]);
  });
});
