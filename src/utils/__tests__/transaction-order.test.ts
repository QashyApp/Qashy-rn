import type { TransactionRecord } from "@/domain/models";
import {
  selectFirst,
  transactionComparator,
} from "@/utils/transaction-order";

function transaction(
  id: string,
  localDate: string,
  createdAt: string,
  baseAmountMinor: number | null = 100,
): TransactionRecord {
  return { id, localDate, createdAt, baseAmountMinor } as TransactionRecord;
}

/** A small deterministic generator, so a failure reproduces. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function ledger(size: number, seed: number): TransactionRecord[] {
  const next = random(seed);
  return Array.from({ length: size }, (_, index) => {
    // Few distinct dates and timestamps, so ties are common.
    const day = String(1 + Math.floor(next() * 6)).padStart(2, "0");
    const second = String(Math.floor(next() * 4)).padStart(2, "0");
    return transaction(
      `id-${index}`,
      `2025-03-${day}`,
      `2025-03-${day}T10:00:${second}.000Z`,
      next() < 0.2 ? null : Math.floor(next() * 5) * 100,
    );
  });
}

describe("transactionComparator", () => {
  it("orders newest first, oldest first and by amount", () => {
    const a = transaction("a", "2025-03-01", "2025-03-01T10:00:00.000Z", 500);
    const b = transaction("b", "2025-03-02", "2025-03-02T10:00:00.000Z", 900);
    const unpriced = transaction("c", "2025-03-03", "x", null);
    expect([a, b].sort(transactionComparator("newest"))).toEqual([b, a]);
    expect([b, a].sort(transactionComparator("oldest"))).toEqual([a, b]);
    expect([unpriced, a, b].sort(transactionComparator("amount-desc"))).toEqual(
      [b, a, unpriced],
    );
  });

  it("breaks a same-day tie by creation time", () => {
    const early = transaction("e", "2025-03-01", "2025-03-01T08:00:00.000Z");
    const late = transaction("l", "2025-03-01", "2025-03-01T20:00:00.000Z");
    expect([early, late].sort(transactionComparator("newest"))).toEqual([
      late,
      early,
    ]);
  });
});

describe("selectFirst", () => {
  it.each(["newest", "oldest", "amount-desc"] as const)(
    "matches sort-then-slice for %s, ties included",
    (order) => {
      const compare = transactionComparator(order);
      for (let seed = 1; seed <= 25; seed += 1) {
        const items = ledger(60 + seed, seed);
        for (const count of [1, 5, 30, 60 + seed, 500]) {
          expect(selectFirst(items, compare, count)).toEqual(
            [...items].sort(compare).slice(0, count),
          );
        }
      }
    },
  );

  it("does not modify its input", () => {
    const items = ledger(40, 7);
    const copy = [...items];
    selectFirst(items, transactionComparator("newest"), 10);
    expect(items).toEqual(copy);
  });
});
