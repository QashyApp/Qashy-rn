import type { FinanceContext } from "@/data/finance/context";
import { canPostNow } from "@/data/finance/rates";
import type { FinanceState, TransactionRecord } from "@/domain/models";

const context = (rates: object[] = []): FinanceContext =>
  ({
    state: {
      settings: { baseCurrency: "USD" },
      exchangeRates: rates.map((rate) => ({
        deletedAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...rate,
      })),
    } as unknown as FinanceState,
    formatLocale: "en-US",
    postedTransactions: () => [],
    transactionById: () => new Map(),
  }) as FinanceContext;

const unpriced = {
  id: "t1",
  kind: "expense",
  status: "upcoming",
  currency: "EUR",
  amountMinor: 10000,
  exchangeRate: null,
  baseAmountMinor: null,
  destinationCurrency: null,
  destinationAmountMinor: null,
  destinationBaseAmountMinor: null,
  localDate: "2026-06-01",
  revision: 1,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  deletedAt: null,
} as unknown as TransactionRecord;

describe("canPostNow", () => {
  it("is false for an unpriced occurrence while no rate is stored", () => {
    expect(canPostNow(context(), unpriced, "2026-06-15")).toBe(false);
  });

  it("is true once a rate covers the pricing date", () => {
    const rates = [
      {
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.1",
        effectiveDate: "2026-06-01",
      },
    ];
    expect(canPostNow(context(rates), unpriced, "2026-06-15")).toBe(true);
  });

  it("is true for an occurrence that is already priced", () => {
    const priced = {
      ...unpriced,
      exchangeRate: "1.1",
      baseAmountMinor: 11000,
    } as TransactionRecord;
    expect(canPostNow(context(), priced, "2026-06-15")).toBe(true);
  });
});
