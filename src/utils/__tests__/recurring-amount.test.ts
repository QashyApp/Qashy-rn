import type {
  ExchangeRate,
  FinanceState,
  RecurringRule,
} from "@/domain/models";
import { recurringDisplayAmount } from "@/utils/recurring-amount";

const state = (rates: Partial<ExchangeRate>[] = []) =>
  ({
    settings: { baseCurrency: "USD" },
    exchangeRates: rates.map((rate) => ({
      deletedAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...rate,
    })),
  }) as unknown as FinanceState;

const rule = (
  template: Partial<RecurringRule["template"]> = {},
): Pick<RecurringRule, "template" | "nextDueDate"> => ({
  nextDueDate: "2026-07-01",
  template: {
    kind: "expense",
    title: "Rent",
    note: "",
    accountId: "a",
    categoryId: null,
    tagIds: [],
    amountMinor: 10000,
    currency: "USD",
    foreign: null,
    fee: null,
    ...template,
  } as RecurringRule["template"],
});

describe("recurringDisplayAmount", () => {
  it("shows a plain schedule's amount in its account currency", () => {
    expect(recurringDisplayAmount(rule(), state(), "en-US")).toEqual({
      amountMinor: 10000,
      currency: "USD",
      unpriced: false,
    });
  });

  it("shows only the foreign amount while no rate can price it", () => {
    // Saved without a rate: the stored estimate is the foreign amount (EUR 100.00) on a USD account.
    const unpriced = rule({
      amountMinor: 10000,
      foreign: { amountMinor: 10000, currency: "EUR" },
    });
    expect(recurringDisplayAmount(unpriced, state(), "en-US")).toEqual({
      amountMinor: 10000,
      currency: "EUR",
      unpriced: true,
    });
  });

  it("prices an unpinned foreign schedule from the rates stored now", () => {
    const unpriced = rule({
      amountMinor: 10000,
      foreign: { amountMinor: 10000, currency: "EUR" },
    });
    const withRate = state([
      {
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.25",
        effectiveDate: "2026-06-01",
      },
    ]);
    expect(recurringDisplayAmount(unpriced, withRate, "en-US")).toEqual({
      amountMinor: 12500,
      currency: "USD",
      unpriced: false,
    });
  });

  it("trusts the stored estimate when the schedule pins its own rate", () => {
    const pinned = rule({
      amountMinor: 11000,
      foreign: { amountMinor: 10000, currency: "EUR", exchangeRate: "1.1" },
    });
    expect(recurringDisplayAmount(pinned, state(), "en-US")).toEqual({
      amountMinor: 11000,
      currency: "USD",
      unpriced: false,
    });
  });
});
