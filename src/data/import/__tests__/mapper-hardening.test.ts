import { mapCashewBackup } from "@/data/import/cashew/mapper";
import {
  ImportError,
  type CashewRawData,
  type ImportBundle,
  type ParseOptions,
  type RawRow,
} from "@/data/import/types";

const OPTIONS: ParseOptions = {
  fallbackTimeZone: "Asia/Jerusalem",
  fallbackCurrency: "ILS",
  today: "2026-01-05",
};

const sec = (date: string) => Date.parse(`${date}T12:00:00Z`) / 1000;

const wallet = (overrides: RawRow = {}): RawRow => ({
  wallet_pk: "0",
  name: "Main",
  currency: "ils",
  decimals: 2,
  archived: 0,
  colour: null,
  icon_name: null,
  emoji_icon_name: null,
  order: 0,
  ...overrides,
});

const category = (overrides: RawRow = {}): RawRow => ({
  category_pk: "c1",
  name: "Food",
  income: 0,
  main_category_pk: null,
  archived: 0,
  colour: null,
  icon_name: "pizza.png",
  emoji_icon_name: null,
  ...overrides,
});

const transaction = (overrides: RawRow = {}): RawRow => ({
  transaction_pk: "t1",
  name: "Lunch",
  note: "",
  amount: -10,
  category_fk: "c1",
  sub_category_fk: null,
  wallet_fk: "0",
  income: 0,
  paid: 1,
  skip_paid: 0,
  type: null,
  reoccurrence: null,
  period_length: null,
  end_date: null,
  paired_transaction_fk: null,
  objective_fk: null,
  objective_loan_fk: null,
  date_created: sec("2026-05-10"),
  ...overrides,
});

const budget = (overrides: RawRow = {}): RawRow => ({
  budget_pk: "b1",
  name: "Monthly",
  amount: 2500,
  start_date: sec("2026-05-01"),
  end_date: sec("2026-05-31"),
  period_length: 1,
  reoccurrence: 3,
  wallet_fks: null,
  category_fks: "[]",
  category_fks_exclude: "[]",
  archived: 0,
  colour: null,
  income: 0,
  added_transactions_only: 0,
  is_absolute_spending_limit: 0,
  budget_transaction_filters: null,
  shared_key: null,
  ...overrides,
});

function rawData(
  tables: Partial<Record<string, RawRow[]>> = {},
  extra: Partial<CashewRawData> = {},
): CashewRawData {
  return {
    userVersion: 48,
    detectedTimeZone: null,
    tables: {
      wallets: [wallet()],
      categories: [category()],
      transactions: [],
      ...tables,
    } as Record<string, RawRow[]>,
    ...extra,
  };
}

const warningCount = (bundle: ImportBundle, code: string) =>
  bundle.report.warnings.find((warning) => warning.code === code)?.count;

describe("Cashew mapper: budget limit arithmetic", () => {
  it("computes a percentage limit in decimal and rounds half up", () => {
    // 10% of 1.15 is 0.115, which is 11.5 minor units, and half-up rounds that to 12.
    const bundle = mapCashewBackup(
      rawData({
        budgets: [budget({ amount: 1.15 })],
        category_budget_limits: [
          { budget_fk: "b1", category_fk: "c1", amount: 10 },
        ],
      }),
      OPTIONS,
    );
    expect(bundle.budgets[0].limitMinor).toBe(115);
    expect(bundle.budgets[0].categoryLimits).toEqual([
      { categoryExternalId: "category:c1", limitMinor: 12 },
    ]);
  });
});

describe("Cashew mapper: intervals and calendar range", () => {
  it("imports an interval past the app's maximum as a regular transaction with a warning", () => {
    const bundle = mapCashewBackup(
      rawData({
        transactions: [
          transaction({
            transaction_pk: "c",
            amount: -5,
            paid: 0,
            type: 1,
            reoccurrence: 3,
            period_length: 1000,
            date_created: sec("2026-05-01"),
          }),
        ],
      }),
      OPTIONS,
    );
    expect(bundle.recurringRules).toHaveLength(0);
    expect(bundle.transactions).toHaveLength(1);
    expect(warningCount(bundle, "recurring-custom-period")).toBe(1);
  });

  it("skips a budget with an oversized interval and reports it as invalid", () => {
    const bundle = mapCashewBackup(
      rawData({
        budgets: [budget({ period_length: 1000 })],
      }),
      OPTIONS,
    );
    expect(bundle.budgets).toHaveLength(0);
    expect(warningCount(bundle, "invalid-budget")).toBe(1);
  });

  it("reports a schedule that runs past year 9999 as an ImportError with the schedule name", () => {
    const build = () =>
      mapCashewBackup(
        rawData({
          transactions: [
            transaction({
              transaction_pk: "far",
              name: "Forever",
              amount: -10,
              paid: 0,
              type: 1,
              reoccurrence: 3,
              period_length: 1,
              // Values above 1e11 are read as milliseconds (see localDateFromSeconds), and a
              // year-9999 timestamp is above that bound in seconds.
              date_created: Date.parse("9999-12-31T12:00:00Z"),
            }),
          ],
        }),
        OPTIONS,
      );
    expect(build).toThrow(ImportError);
    try {
      build();
    } catch (error) {
      expect((error as ImportError).code).toBe("unsupported");
      expect((error as ImportError).message).toContain("Forever");
    }
  });
});

describe("Cashew mapper: recurring series", () => {
  it("splits same-named subscriptions with different posted amounts into separate series", () => {
    const bundle = mapCashewBackup(
      rawData({
        transactions: [
          transaction({
            transaction_pk: "p1",
            name: "Netflix",
            amount: -10,
            paid: 1,
            type: 1,
            reoccurrence: 3,
            period_length: 1,
            date_created: sec("2026-03-01"),
          }),
          transaction({
            transaction_pk: "p2",
            name: "Netflix",
            amount: -15,
            paid: 1,
            type: 1,
            reoccurrence: 3,
            period_length: 1,
            date_created: sec("2026-04-01"),
          }),
          transaction({
            transaction_pk: "u1",
            name: "Netflix",
            amount: -15,
            paid: 0,
            type: 1,
            reoccurrence: 3,
            period_length: 1,
            date_created: sec("2026-05-01"),
          }),
        ],
      }),
      OPTIONS,
    );
    expect(bundle.recurringRules).toHaveLength(1);
    expect(bundle.recurringRules[0]).toMatchObject({
      externalId: "recurring:u1",
      amountMinor: 1500,
    });
    const byPk = (pk: string) =>
      bundle.transactions.find(
        (item) => item.externalId === `transaction:${pk}`,
      );
    // The earlier, finished 10.00 series is not attached to the live 15.00 schedule.
    expect(byPk("p1")?.recurringRuleExternalId).toBeNull();
    expect(byPk("p2")?.recurringRuleExternalId).toBe("recurring:u1");
  });

  it("anchors the schedule to its first entry so a month-end date does not drift", () => {
    // From the 30th, the next monthly step is March 30. Without the anchor it would be
    // March 28 (stepping from February 28), which is overdue on March 29 and would be a catch-up.
    const bundle = mapCashewBackup(
      rawData({
        transactions: [
          transaction({
            transaction_pk: "p0",
            name: "Gym",
            amount: -10,
            paid: 1,
            type: 1,
            reoccurrence: 3,
            period_length: 1,
            date_created: sec("2026-01-30"),
          }),
          transaction({
            transaction_pk: "u",
            name: "Gym",
            amount: -10,
            paid: 0,
            type: 1,
            reoccurrence: 3,
            period_length: 1,
            date_created: sec("2026-02-28"),
          }),
        ],
      }),
      { ...OPTIONS, today: "2026-03-29" },
    );
    expect(warningCount(bundle, "recurring-catch-up")).toBeUndefined();
    expect(bundle.recurringRules).toHaveLength(1);
    expect(bundle.recurringRules[0]).toMatchObject({
      externalId: "recurring:u",
      nextDueDate: "2026-02-28",
    });
  });
});
