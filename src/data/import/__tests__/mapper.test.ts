import * as fs from "fs";

import { mapCashewCategoryIcon } from "@/data/import/cashew/icon-map";
import {
  mapCashewBackup,
  reconcileBalances,
} from "@/data/import/cashew/mapper";
import { parseExternalBackup } from "@/data/import/parse";
import {
  ImportError,
  type BundleAccount,
  type BundleTransaction,
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

/** Noon UTC keeps the local date identical in Jerusalem and New York. */
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
      categories: [
        category(),
        category({
          category_pk: "c2",
          name: "Salary",
          income: 1,
          icon_name: "money.png",
        }),
      ],
      transactions: [],
      ...tables,
    } as Record<string, RawRow[]>,
    ...extra,
  };
}

/** Checks the invariants the repository would enforce, so every test also proves the bundle is importable. */
function assertValid(bundle: ImportBundle) {
  const unique = (ids: string[]) => expect(new Set(ids).size).toBe(ids.length);
  unique(bundle.accounts.map((item) => item.externalId));
  unique(bundle.categories.map((item) => item.externalId));
  unique(bundle.tags.map((item) => item.externalId));
  unique(bundle.transactions.map((item) => item.externalId));
  unique(bundle.recurringRules.map((item) => item.externalId));
  unique(bundle.budgets.map((item) => item.externalId));
  unique(bundle.accounts.map((item) => item.name.trim().toLowerCase()));
  unique(bundle.categories.map((item) => item.name.trim().toLowerCase()));
  unique(bundle.tags.map((item) => item.name.trim().toLowerCase()));
  const accounts = new Map(
    bundle.accounts.map((item) => [item.externalId, item]),
  );
  const categories = new Map(
    bundle.categories.map((item) => [item.externalId, item]),
  );
  const tags = new Set(bundle.tags.map((item) => item.externalId));
  const rules = new Map(
    bundle.recurringRules.map((item) => [item.externalId, item]),
  );
  for (const item of bundle.categories) {
    expect(item.color).toMatch(/^#[0-9A-F]{6}$/);
    if (item.parentExternalId) {
      const parent = categories.get(item.parentExternalId);
      expect(parent).toBeDefined();
      expect(parent?.kind).toBe(item.kind);
      expect(parent?.parentExternalId).toBeNull();
    }
  }
  for (const item of bundle.transactions) {
    expect(accounts.has(item.accountExternalId)).toBe(true);
    expect(Number.isSafeInteger(item.amountMinor) && item.amountMinor > 0).toBe(
      true,
    );
    expect(item.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    item.tagExternalIds.forEach((id) => expect(tags.has(id)).toBe(true));
    if (item.kind === "transfer") {
      expect(accounts.has(item.destinationAccountExternalId ?? "")).toBe(true);
      expect(item.categoryExternalId).toBeNull();
      expect(item.destinationAmountMinor).toBeGreaterThan(0);
    } else if (item.categoryExternalId) {
      expect(categories.get(item.categoryExternalId)?.kind).toBe(item.kind);
    }
    if (item.recurringRuleExternalId)
      expect(rules.has(item.recurringRuleExternalId)).toBe(true);
  }
  for (const item of bundle.recurringRules) {
    expect(accounts.has(item.accountExternalId)).toBe(true);
    expect(item.startDate).toBe(item.nextDueDate);
    expect(item.autoPost).toBe(false);
    expect(item.amountMinor).toBeGreaterThan(0);
    if (item.categoryExternalId)
      expect(categories.get(item.categoryExternalId)?.kind).toBe(item.kind);
    if (item.endDate) expect(item.endDate >= item.startDate).toBe(true);
  }
  for (const item of bundle.budgets) {
    item.categoryExternalIds.forEach((id) =>
      expect(categories.get(id)?.kind).toBe("expense"),
    );
    item.categoryLimits.forEach((limit) =>
      expect(item.categoryExternalIds).toContain(limit.categoryExternalId),
    );
  }
  bundle.report.balanceChecks.forEach((check) =>
    expect(check.importedBalanceMinor).toBe(check.sourceBalanceMinor),
  );
}

function map(raw: CashewRawData, options: ParseOptions = OPTIONS) {
  const bundle = mapCashewBackup(raw, options);
  assertValid(bundle);
  return bundle;
}

const warning = (bundle: ImportBundle, code: string) =>
  bundle.report.warnings.find((item) => item.code === code);
const byId = (bundle: ImportBundle, id: string) => {
  const found = bundle.transactions.find((item) => item.externalId === id);
  if (!found) throw new Error(`Missing transaction ${id}`);
  return found;
};

describe("mapCashewBackup money", () => {
  it("converts amounts to exact minor units without float error", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            transaction_pk: "a",
            amount: 1454.35,
            income: 1,
            category_fk: "c2",
          }),
          transaction({ transaction_pk: "b", amount: 8.1 }),
          transaction({ transaction_pk: "c", amount: -668.47 }),
          transaction({ transaction_pk: "d", amount: 4.35 }),
          transaction({ transaction_pk: "e", amount: 1.005 }),
        ],
      }),
    );
    expect(byId(bundle, "transaction:a").amountMinor).toBe(145435);
    expect(byId(bundle, "transaction:b").amountMinor).toBe(810);
    expect(byId(bundle, "transaction:c").amountMinor).toBe(66847);
    expect(byId(bundle, "transaction:d").amountMinor).toBe(435);
    // 1.005 has a third decimal: half rounds away from zero.
    expect(byId(bundle, "transaction:e").amountMinor).toBe(101);
  });

  it("uses each wallet currency exponent", () => {
    const bundle = map(
      rawData({
        wallets: [
          wallet({ wallet_pk: "jp", name: "Yen", currency: "jpy" }),
          wallet({ wallet_pk: "kw", name: "Dinar", currency: "kwd" }),
          wallet({ wallet_pk: "us", name: "Dollar", currency: "usd" }),
        ],
        transactions: [
          transaction({ transaction_pk: "a", wallet_fk: "jp", amount: -1200 }),
          transaction({
            transaction_pk: "b",
            wallet_fk: "kw",
            amount: -12.345,
          }),
          transaction({ transaction_pk: "c", wallet_fk: "us", amount: -12.34 }),
        ],
      }),
    );
    expect(byId(bundle, "transaction:a").amountMinor).toBe(1200);
    expect(byId(bundle, "transaction:b").amountMinor).toBe(12345);
    expect(byId(bundle, "transaction:c").amountMinor).toBe(1234);
    expect(bundle.accounts.map((item) => item.currency)).toEqual([
      "JPY",
      "KWD",
      "USD",
    ]);
    expect(warning(bundle, "rounded-amounts")).toBeUndefined();
  });

  it("warns once with a count when amounts had to be rounded", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ transaction_pk: "a", amount: 0.1 + 0.2 }),
          transaction({ transaction_pk: "b", amount: -10.999 }),
          transaction({ transaction_pk: "c", amount: -10.5 }),
        ],
      }),
    );
    expect(byId(bundle, "transaction:a").amountMinor).toBe(30);
    expect(byId(bundle, "transaction:b").amountMinor).toBe(1100);
    expect(warning(bundle, "rounded-amounts")?.count).toBe(2);
    expect(
      bundle.report.warnings.filter((item) => item.code === "rounded-amounts"),
    ).toHaveLength(1);
  });

  it("skips zero, unreadable, out-of-range and dateless rows and reports them", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ transaction_pk: "ok", amount: -5 }),
          transaction({ transaction_pk: "zero", amount: 0 }),
          transaction({ transaction_pk: "nan", amount: "abc" }),
          transaction({ transaction_pk: "huge", amount: 1e20 }),
          transaction({ transaction_pk: "nodate", date_created: null }),
          transaction({ transaction_pk: "nowallet", wallet_fk: "ghost" }),
        ],
      }),
    );
    expect(bundle.transactions.map((item) => item.externalId)).toEqual([
      "transaction:ok",
    ]);
    expect(warning(bundle, "zero-amount")?.count).toBe(1);
    expect(warning(bundle, "invalid-amount")?.count).toBe(2);
    expect(warning(bundle, "invalid-date")?.count).toBe(1);
    expect(warning(bundle, "missing-wallet")?.count).toBe(1);
  });
});

describe("mapCashewBackup transactions", () => {
  it("derives kind from the amount sign and status from paid/skip_paid", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ transaction_pk: "out", amount: -5 }),
          transaction({
            transaction_pk: "in",
            amount: 5,
            income: 1,
            category_fk: "c2",
          }),
          transaction({ transaction_pk: "both", paid: 1, skip_paid: 1 }),
          transaction({ transaction_pk: "skipped", paid: 0, skip_paid: 1 }),
          transaction({
            transaction_pk: "later",
            paid: 0,
            skip_paid: 0,
            type: 0,
          }),
        ],
      }),
    );
    expect(byId(bundle, "transaction:out").kind).toBe("expense");
    expect(byId(bundle, "transaction:in").kind).toBe("income");
    expect(byId(bundle, "transaction:both").status).toBe("posted");
    expect(byId(bundle, "transaction:skipped").status).toBe("skipped");
    expect(byId(bundle, "transaction:later").status).toBe("upcoming");
    expect(
      byId(bundle, "transaction:later").recurringRuleExternalId,
    ).toBeNull();
    const check = bundle.report.balanceChecks[0];
    expect(check.importedBalanceMinor).toBe(-500 + 500 - 1000);
  });

  it("falls back to the category name, then a generic title, when the name is empty", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ transaction_pk: "a", name: "   " }),
          transaction({ transaction_pk: "b", name: "", category_fk: "ghost" }),
        ],
      }),
    );
    expect(byId(bundle, "transaction:a").title).toBe("Food");
    expect(byId(bundle, "transaction:b").title).toBe("Transaction");
    expect(byId(bundle, "transaction:b").categoryExternalId).toBeNull();
    expect(warning(bundle, "empty-title")?.count).toBe(2);
    expect(warning(bundle, "missing-category")?.count).toBe(1);
  });

  it("keeps Hebrew titles and notes intact and trims whitespace", () => {
    const bundle = map(
      rawData({
        transactions: [transaction({ name: "  קפה בבוקר ", note: " הערה " })],
      }),
    );
    expect(bundle.transactions[0].title).toBe("קפה בבוקר");
    expect(bundle.transactions[0].note).toBe("הערה");
  });

  it("files a transaction under its subcategory when one is set", () => {
    const bundle = map(
      rawData({
        categories: [
          category(),
          category({
            category_pk: "c3",
            name: "Pizza",
            main_category_pk: "c1",
            icon_name: "pizza.png",
          }),
        ],
        transactions: [transaction({ sub_category_fk: "c3" })],
      }),
    );
    expect(bundle.transactions[0].categoryExternalId).toBe("category:c3");
    const child = bundle.categories.find(
      (item) => item.externalId === "category:c3",
    );
    expect(child?.parentExternalId).toBe("category:c1");
    expect(bundle.categories[0].parentExternalId).toBeNull();
  });

  it("flattens subcategories that cannot keep their parent", () => {
    const bundle = map(
      rawData({
        categories: [
          category(),
          category({ category_pk: "c2", name: "Salary", income: 1 }),
          category({
            category_pk: "c3",
            name: "Sub of income",
            main_category_pk: "c2",
          }),
          category({
            category_pk: "c4",
            name: "Child",
            main_category_pk: "c1",
          }),
          category({
            category_pk: "c5",
            name: "Grandchild",
            main_category_pk: "c4",
          }),
          category({
            category_pk: "c6",
            name: "Orphan",
            main_category_pk: "nowhere",
          }),
        ],
      }),
    );
    const parents = Object.fromEntries(
      bundle.categories.map((item) => [item.externalId, item.parentExternalId]),
    );
    expect(parents["category:c3"]).toBeNull();
    expect(parents["category:c4"]).toBe("category:c1");
    expect(parents["category:c5"]).toBeNull();
    expect(parents["category:c6"]).toBeNull();
    expect(warning(bundle, "subcategory-flattened")?.count).toBe(3);
  });

  it("creates a twin category once when the kind of a transaction and its category disagree", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            transaction_pk: "a",
            amount: 50,
            income: 1,
            category_fk: "c1",
          }),
          transaction({
            transaction_pk: "b",
            amount: 70,
            income: 1,
            category_fk: "c1",
          }),
          transaction({ transaction_pk: "c", amount: -20, category_fk: "c2" }),
        ],
      }),
    );
    expect(byId(bundle, "transaction:a").categoryExternalId).toBe(
      "category:c1:income",
    );
    expect(byId(bundle, "transaction:b").categoryExternalId).toBe(
      "category:c1:income",
    );
    expect(byId(bundle, "transaction:c").categoryExternalId).toBe(
      "category:c2:expense",
    );
    const twin = bundle.categories.find(
      (item) => item.externalId === "category:c1:income",
    );
    expect(twin).toMatchObject({
      name: "Food (income)",
      kind: "income",
      parentExternalId: null,
    });
    const source = bundle.categories.find(
      (item) => item.externalId === "category:c1",
    );
    expect(twin?.icon).toBe(source?.icon);
    expect(twin?.color).toBe(source?.color);
    expect(bundle.categories).toHaveLength(4);
    expect(warning(bundle, "category-split")?.count).toBe(3);
  });

  it("de-duplicates category, account and tag names globally", () => {
    const bundle = map(
      rawData({
        wallets: [
          wallet(),
          wallet({ wallet_pk: "1", name: " main " }),
          wallet({ wallet_pk: "2", name: "" }),
        ],
        categories: [
          category(),
          category({ category_pk: "c2", name: "food" }),
          category({ category_pk: "c3", name: "Food", income: 1 }),
          category({ category_pk: "c4", name: "" }),
          category({ category_pk: "c5", name: "Food (2)" }),
        ],
        tags: [
          { tag_pk: "t1", name: "Trip", colour: "0xff112233" },
          { tag_pk: "t2", name: "trip", colour: null },
        ],
      }),
    );
    expect(bundle.accounts.map((item) => item.name)).toEqual([
      "Main",
      "main (2)",
      "Account",
    ]);
    expect(bundle.categories.map((item) => item.name)).toEqual([
      "Food",
      "food (2)",
      "Food (3)",
      "Category",
      "Food (2) (2)",
    ]);
    expect(bundle.tags).toEqual([
      { externalId: "tag:t1", name: "Trip", color: "#112233" },
      { externalId: "tag:t2", name: "trip (2)", color: "#6D7885" },
    ]);
  });

  it("links existing tags only and converts colours", () => {
    const bundle = map(
      rawData({
        wallets: [wallet({ colour: "0xff0a1b2c" })],
        tags: [{ tag_pk: "t1", name: "Trip", colour: null }],
        transaction_to_tag_links: [
          { transaction_pk: "t1", tag_pk: "t1" },
          { transaction_pk: "t1", tag_pk: "t1" },
          { transaction_pk: "t1", tag_pk: "gone" },
        ],
        transactions: [transaction()],
      }),
    );
    expect(bundle.transactions[0].tagExternalIds).toEqual(["tag:t1"]);
    expect(bundle.accounts[0].color).toBe("#0A1B2C");
    expect(bundle.accounts[0]).toMatchObject({
      type: "checking",
      openingBalanceMinor: 0,
      archived: false,
    });
  });

  it("defaults a missing wallet currency to the base currency", () => {
    const bundle = map(
      rawData({
        wallets: [
          wallet({ currency: null }),
          wallet({ wallet_pk: "1", name: "Odd", currency: "zzz" }),
        ],
      }),
    );
    expect(bundle.accounts.map((item) => item.currency)).toEqual([
      "ILS",
      "ILS",
    ]);
    expect(warning(bundle, "wallet-currency-default")?.count).toBe(2);
  });
});

describe("mapCashewBackup transfers", () => {
  const twoWallets = [
    wallet(),
    wallet({ wallet_pk: "1", name: "Dollars", currency: "usd" }),
  ];

  it("merges a cross-currency pair into a single transfer", () => {
    const bundle = map(
      rawData({
        wallets: twoWallets,
        transactions: [
          transaction({
            transaction_pk: "in",
            wallet_fk: "1",
            amount: 27.5,
            income: 1,
            paired_transaction_fk: "out",
            name: "ignored",
          }),
          transaction({
            transaction_pk: "out",
            wallet_fk: "0",
            amount: -100,
            paired_transaction_fk: "in",
            name: "Exchange",
            date_created: sec("2026-05-11"),
          }),
        ],
      }),
    );
    expect(bundle.transactions).toHaveLength(1);
    expect(bundle.transactions[0]).toMatchObject({
      externalId: "transaction:out",
      kind: "transfer",
      status: "posted",
      title: "Exchange",
      localDate: "2026-05-11",
      accountExternalId: "wallet:0",
      destinationAccountExternalId: "wallet:1",
      categoryExternalId: null,
      amountMinor: 10000,
      destinationAmountMinor: 2750,
    });
    expect(
      bundle.report.balanceChecks.map((item) => item.importedBalanceMinor),
    ).toEqual([-10000, 2750]);
    expect(warning(bundle, "transfer-unpaired")).toBeUndefined();
  });

  it("imports an unmatched transfer half as a normal transaction", () => {
    const bundle = map(
      rawData({
        wallets: twoWallets,
        transactions: [
          transaction({
            transaction_pk: "lonely",
            paired_transaction_fk: "missing",
          }),
        ],
      }),
    );
    expect(bundle.transactions[0]).toMatchObject({
      kind: "expense",
      categoryExternalId: "category:c1",
    });
    expect(warning(bundle, "transfer-unpaired")?.count).toBe(1);
  });

  it("does not merge same-sign, same-wallet or differently-settled pairs", () => {
    const bundle = map(
      rawData({
        wallets: twoWallets,
        transactions: [
          transaction({
            transaction_pk: "a",
            wallet_fk: "0",
            amount: -5,
            paired_transaction_fk: "b",
          }),
          transaction({
            transaction_pk: "b",
            wallet_fk: "1",
            amount: -5,
            paired_transaction_fk: "a",
          }),
          transaction({
            transaction_pk: "c",
            wallet_fk: "0",
            amount: -5,
            paired_transaction_fk: "d",
          }),
          transaction({
            transaction_pk: "d",
            wallet_fk: "0",
            amount: 5,
            income: 1,
            category_fk: "c2",
            paired_transaction_fk: "c",
          }),
          transaction({
            transaction_pk: "e",
            wallet_fk: "0",
            amount: -5,
            paired_transaction_fk: "f",
          }),
          transaction({
            transaction_pk: "f",
            wallet_fk: "1",
            amount: 5,
            income: 1,
            category_fk: "c2",
            paired_transaction_fk: "e",
            paid: 0,
            skip_paid: 0,
          }),
        ],
      }),
    );
    expect(
      bundle.transactions.filter((item) => item.kind === "transfer"),
    ).toHaveLength(0);
    expect(bundle.transactions).toHaveLength(6);
    expect(warning(bundle, "transfer-unpaired")?.count).toBe(6);
  });
});

describe("mapCashewBackup loans and objectives", () => {
  it("skips loans and debts and keeps balances consistent", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ transaction_pk: "ok", amount: -5 }),
          transaction({ transaction_pk: "lent", amount: -100, type: 3 }),
          transaction({
            transaction_pk: "borrowed",
            amount: 100,
            income: 1,
            type: 4,
          }),
          transaction({
            transaction_pk: "linked",
            amount: -7,
            objective_loan_fk: "loan-1",
          }),
        ],
      }),
    );
    expect(bundle.transactions.map((item) => item.externalId)).toEqual([
      "transaction:ok",
    ]);
    expect(warning(bundle, "loans-skipped")?.count).toBe(3);
    expect(bundle.report.balanceChecks[0].sourceBalanceMinor).toBe(-500);
  });

  it("imports objective transactions as normal ones and reports the dropped objectives", () => {
    const bundle = map(
      rawData({
        objectives: [
          { objective_pk: "o1", name: "Trip" },
          { objective_pk: "o2", name: "Car" },
        ],
        transactions: [transaction({ objective_fk: "o1" })],
      }),
    );
    expect(bundle.transactions).toHaveLength(1);
    expect(warning(bundle, "objectives-not-imported")?.count).toBe(2);
  });

  it("reports dropped associated titles and scanner templates only when present", () => {
    const none = map(rawData());
    expect(warning(none, "associated-titles-dropped")).toBeUndefined();
    const some = map(
      rawData({
        associated_titles: [
          { associated_title_pk: "a" },
          { associated_title_pk: "b" },
        ],
        scanner_templates: [{ scanner_template_pk: "a" }],
      }),
    );
    expect(warning(some, "associated-titles-dropped")?.count).toBe(2);
    expect(warning(some, "scanner-templates-dropped")?.count).toBe(1);
  });
});

describe("mapCashewBackup recurring transactions", () => {
  const series = (base: string, overrides: RawRow = {}) => ({
    type: 2,
    reoccurrence: 3,
    period_length: 1,
    ...overrides,
    transaction_pk: base,
  });

  it("groups a series by base pk, links paid history and derives the next due date from the unpaid row", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("r1"),
            date_created: sec("2026-01-05"),
            name: "Rent",
            amount: -3000,
          }),
          transaction({
            ...series("r1::predict::1"),
            date_created: sec("2026-02-05"),
            name: "Rent",
            amount: -3000,
          }),
          transaction({
            ...series("r1::predict::2"),
            date_created: sec("2026-03-05"),
            name: "Rent",
            amount: -3000,
            paid: 0,
            skip_paid: 0,
          }),
          transaction({
            ...series("r1::predict::3"),
            date_created: sec("2026-04-05"),
            name: "Rent",
            amount: -3000,
            paid: 0,
            skip_paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(1);
    expect(bundle.recurringRules[0]).toMatchObject({
      externalId: "recurring:r1",
      kind: "expense",
      title: "Rent",
      accountExternalId: "wallet:0",
      categoryExternalId: "category:c1",
      amountMinor: 300000,
      currency: "ILS",
      unit: "month",
      interval: 1,
      startDate: "2026-03-05",
      nextDueDate: "2026-03-05",
      endDate: null,
      autoPost: false,
      active: true,
    });
    // The paid history, plus the earliest unpaid entry as the schedule's waiting occurrence. The
    // later unpaid one (predict::3) is left for the schedule to generate when it comes due.
    expect(
      bundle.transactions.map((item) => [item.externalId, item.status]),
    ).toEqual([
      ["transaction:r1", "posted"],
      ["transaction:r1::predict::1", "posted"],
      ["transaction:r1::predict::2", "upcoming"],
    ]);
    bundle.transactions.forEach((item) => {
      expect(item.recurringRuleExternalId).toBe("recurring:r1");
    });
    expect(warning(bundle, "recurring-review")?.count).toBe(1);
  });

  it("treats a series with no upcoming entry as ended: history only, no schedule", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("w", { reoccurrence: 2, period_length: 2 }),
            date_created: sec("2026-01-01"),
          }),
          transaction({
            ...series("w::predict::1", { reoccurrence: 2, period_length: 2 }),
            date_created: sec("2026-01-15"),
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(0);
    expect(
      bundle.transactions.map((item) => [
        item.externalId,
        item.status,
        item.recurringRuleExternalId,
      ]),
    ).toEqual([
      ["transaction:w", "posted", null],
      ["transaction:w::predict::1", "posted", null],
    ]);
    expect(warning(bundle, "recurring-ended")?.count).toBe(1);
    expect(warning(bundle, "recurring-ended")?.message).toBe(
      "Subscriptions and repeating transactions with no upcoming entry in Cashew were treated as ended: their past payments were imported, but no schedule was created.",
    );
    expect(warning(bundle, "recurring-review")).toBeUndefined();
  });

  it("uses the earliest unpaid entry as the next due date", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ ...series("u"), date_created: sec("2026-01-05") }),
          transaction({
            ...series("u::predict::2"),
            date_created: sec("2026-03-05"),
            paid: 0,
          }),
          transaction({
            ...series("u::predict::1"),
            date_created: sec("2026-02-05"),
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules[0]).toMatchObject({
      startDate: "2026-02-05",
      nextDueDate: "2026-02-05",
    });
    expect(warning(bundle, "recurring-ended")).toBeUndefined();
  });

  it("maps every recurrence unit and clamps the interval to at least one", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("d", { reoccurrence: 1, period_length: 3 }),
            date_created: sec("2026-01-01"),
          }),
          transaction({
            ...series("d::predict::1", { reoccurrence: 1, period_length: 3 }),
            date_created: sec("2026-01-04"),
            paid: 0,
          }),
          transaction({
            ...series("y", { reoccurrence: 4, period_length: 0, type: 1 }),
            date_created: sec("2026-01-01"),
          }),
          transaction({
            ...series("y::predict::1", {
              reoccurrence: 4,
              period_length: 0,
              type: 1,
            }),
            date_created: sec("2027-01-01"),
            paid: 0,
          }),
        ],
      }),
    );
    const units = Object.fromEntries(
      bundle.recurringRules.map((item) => [
        item.externalId,
        [item.unit, item.interval, item.nextDueDate],
      ]),
    );
    expect(units["recurring:d"]).toEqual(["day", 3, "2026-01-04"]);
    expect(units["recurring:y"]).toEqual(["year", 1, "2027-01-01"]);
  });

  it("treats different base pks as different series", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ ...series("a"), date_created: sec("2026-01-05") }),
          transaction({
            ...series("a::predict::1"),
            date_created: sec("2026-02-05"),
            paid: 0,
          }),
          transaction({
            ...series("b"),
            date_created: sec("2026-01-06"),
            amount: -20,
          }),
          transaction({
            ...series("b::predict::1"),
            date_created: sec("2026-02-06"),
            amount: -20,
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules.map((item) => item.externalId)).toEqual([
      "recurring:a",
      "recurring:b",
    ]);
    expect(bundle.recurringRules[1].amountMinor).toBe(2000);
    expect(warning(bundle, "recurring-review")?.count).toBe(2);
  });

  it("carries the end date onto the rule", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("e"),
            date_created: sec("2026-01-05"),
            end_date: sec("2026-12-31"),
          }),
          transaction({
            ...series("e::predict::1"),
            date_created: sec("2026-02-05"),
            end_date: sec("2026-12-31"),
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules[0]).toMatchObject({
      nextDueDate: "2026-02-05",
      endDate: "2026-12-31",
    });
  });

  it("emits no rule for a finished series and keeps its paid rows as plain posted transactions", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("f"),
            date_created: sec("2026-01-05"),
            end_date: sec("2026-02-10"),
          }),
          transaction({
            ...series("f::predict::1"),
            date_created: sec("2026-02-05"),
            end_date: sec("2026-02-10"),
          }),
          transaction({
            ...series("f::predict::2"),
            date_created: sec("2026-03-05"),
            end_date: sec("2026-02-10"),
            paid: 0,
            skip_paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(0);
    expect(bundle.transactions).toHaveLength(2);
    bundle.transactions.forEach((item) => {
      expect(item.status).toBe("posted");
      expect(item.recurringRuleExternalId).toBeNull();
    });
    expect(warning(bundle, "recurring-review")).toBeUndefined();
  });

  it("imports a custom-period series as plain transactions", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("c", { reoccurrence: 0 }),
            date_created: sec("2026-01-05"),
          }),
          transaction({
            ...series("c::predict::1", { reoccurrence: 0 }),
            date_created: sec("2026-02-05"),
            paid: 0,
            skip_paid: 0,
          }),
          transaction({
            ...series("n", { reoccurrence: null }),
            date_created: sec("2026-01-05"),
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(0);
    expect(
      bundle.transactions.map((item) => [
        item.externalId,
        item.status,
        item.recurringRuleExternalId,
      ]),
    ).toEqual([
      ["transaction:c", "posted", null],
      ["transaction:c::predict::1", "upcoming", null],
      ["transaction:n", "posted", null],
    ]);
    expect(warning(bundle, "recurring-custom-period")?.count).toBe(2);
  });

  it("keeps skipped occurrences as plain skipped transactions", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ ...series("s"), date_created: sec("2026-01-05") }),
          transaction({
            ...series("s::predict::1"),
            date_created: sec("2026-02-05"),
            paid: 0,
            skip_paid: 1,
          }),
          transaction({
            ...series("s::predict::2"),
            date_created: sec("2026-03-05"),
            paid: 0,
            skip_paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules[0].nextDueDate).toBe("2026-03-05");
    expect(byId(bundle, "transaction:s::predict::1")).toMatchObject({
      status: "skipped",
      recurringRuleExternalId: null,
    });
    expect(byId(bundle, "transaction:s")).toMatchObject({
      status: "posted",
      recurringRuleExternalId: "recurring:s",
    });
    // The skipped entry stays as history; the next unpaid one is the waiting occurrence.
    expect(byId(bundle, "transaction:s::predict::2")).toMatchObject({
      status: "upcoming",
      recurringRuleExternalId: "recurring:s",
    });
    expect(bundle.transactions).toHaveLength(3);
  });

  it("carries only the earliest unpaid entry of a live series, and none for a finished one", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("live"),
            date_created: sec("2025-12-05"),
            name: "Live",
          }),
          transaction({
            ...series("live::predict::1"),
            date_created: sec("2026-01-10"),
            name: "Live",
            paid: 0,
          }),
          transaction({
            ...series("live::predict::2"),
            date_created: sec("2026-02-10"),
            name: "Live",
            paid: 0,
          }),
          transaction({
            ...series("live::predict::3"),
            date_created: sec("2026-03-10"),
            name: "Live",
            paid: 0,
          }),
          // A series whose only unpaid entry is long overdue is stopped: nothing is carried.
          transaction({
            ...series("old"),
            date_created: sec("2024-06-05"),
            name: "Old",
          }),
          transaction({
            ...series("old::predict::1"),
            date_created: sec("2024-07-05"),
            name: "Old",
            paid: 0,
          }),
        ],
      }),
    );
    const upcoming = bundle.transactions.filter(
      (item) => item.status === "upcoming",
    );
    expect(upcoming.map((item) => item.externalId)).toEqual([
      "transaction:live::predict::1",
    ]);
    expect(upcoming[0]).toMatchObject({
      localDate: "2026-01-10",
      recurringRuleExternalId: "recurring:live",
    });
    // The schedule's next due date is the same entry, so the generator will not make it again.
    expect(bundle.recurringRules.map((rule) => rule.nextDueDate)).toEqual([
      "2026-01-10",
    ]);
    expect(
      bundle.transactions.some((item) =>
        item.externalId.startsWith("transaction:old::"),
      ),
    ).toBe(false);
  });

  // Cashew pays subscriptions itself when they fall due and then creates the next entry, so an
  // entry that is overdue just means it has not been opened since.
  const overdueSeries = (overrides: Record<string, unknown> = {}, extra = {}) =>
    rawData(
      {
        transactions: [
          transaction({ ...series("late"), date_created: sec("2025-09-05") }),
          transaction({
            ...series("late::predict::1"),
            date_created: sec("2025-10-05"),
            paid: 0,
            ...overrides,
          }),
        ],
      },
      extra,
    );

  it("keeps a series Cashew had not paid yet, because Cashew pays it when it is opened", () => {
    const bundle = map(overdueSeries());
    expect(bundle.recurringRules).toHaveLength(1);
    expect(bundle.recurringRules[0].nextDueDate).toBe("2025-10-05");
    expect(warning(bundle, "recurring-catch-up")?.count).toBe(1);
    expect(warning(bundle, "recurring-stale")).toBeUndefined();
  });

  it("treats the same series as stopped when Cashew is set not to pay it automatically", () => {
    for (const autoPay of [
      { subscriptions: false, repetitive: false },
      { subscriptions: false, repetitive: true },
    ]) {
      const bundle = map(overdueSeries({}, { autoPay }));
      // The fixture series is a repeating transaction (type 2) when only subscriptions are off.
      const stopped = autoPay.repetitive === false;
      expect(bundle.recurringRules).toHaveLength(stopped ? 0 : 1);
      expect(warning(bundle, "recurring-stale")?.count).toBe(
        stopped ? 1 : undefined,
      );
    }
  });

  it("uses the subscription preference for subscriptions and the repeating one for repeating", () => {
    const subscription = (autoPay: {
      subscriptions: boolean | null;
      repetitive: boolean | null;
    }) =>
      map(
        rawData(
          {
            transactions: [
              transaction({
                ...series("s", { type: 1 }),
                date_created: sec("2025-09-05"),
              }),
              transaction({
                ...series("s::predict::1", { type: 1 }),
                date_created: sec("2025-10-05"),
                paid: 0,
              }),
            ],
          },
          { autoPay },
        ),
      );
    expect(
      subscription({ subscriptions: true, repetitive: false }).recurringRules,
    ).toHaveLength(1);
    expect(
      subscription({ subscriptions: false, repetitive: true }).recurringRules,
    ).toHaveLength(0);
    // The backup not saying is Cashew's default: on.
    expect(
      subscription({ subscriptions: null, repetitive: null }).recurringRules,
    ).toHaveLength(1);
  });

  it("treats an entry the user un-paid as stopped: Cashew will not pay it again", () => {
    const bundle = map(
      overdueSeries({ created_another_future_transaction: 1 }),
    );
    expect(bundle.recurringRules).toHaveLength(0);
    expect(warning(bundle, "recurring-stale")?.count).toBe(1);
  });

  it("treats a series overdue for a very long time as stopped", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ ...series("old"), date_created: sec("2024-06-05") }),
          transaction({
            ...series("old::predict::1"),
            date_created: sec("2024-07-05"),
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(0);
    expect(bundle.transactions.map((item) => item.externalId)).toEqual([
      "transaction:old",
    ]);
    expect(byId(bundle, "transaction:old").recurringRuleExternalId).toBeNull();
    expect(warning(bundle, "recurring-stale")?.count).toBe(1);
  });

  it("keeps a series overdue by less than one period", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ ...series("due"), date_created: sec("2025-11-20") }),
          transaction({
            ...series("due::predict::1"),
            date_created: sec("2025-12-20"),
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules[0].nextDueDate).toBe("2025-12-20");
    expect(warning(bundle, "recurring-stale")).toBeUndefined();
  });

  it("treats a series whose next entry falls after its end date as ended", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("x"),
            date_created: sec("2025-12-01"),
            end_date: sec("2025-12-20"),
          }),
          transaction({
            ...series("x::predict::1"),
            date_created: sec("2026-01-01"),
            end_date: sec("2025-12-20"),
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(0);
    expect(warning(bundle, "recurring-ended")?.count).toBe(1);
  });

  it("keeps the final entry of a series whose end date has just passed: it is still due", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("x"),
            date_created: sec("2025-12-01"),
            end_date: sec("2026-01-01"),
          }),
          transaction({
            ...series("x::predict::1"),
            date_created: sec("2026-01-01"),
            end_date: sec("2026-01-01"),
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(1);
    expect(bundle.recurringRules[0]).toMatchObject({
      nextDueDate: "2026-01-01",
      endDate: "2026-01-01",
    });
    expect(warning(bundle, "recurring-ended")).toBeUndefined();
  });

  it("groups Cashew occurrences that each have their own pk into one series", () => {
    const occurrence = (pk: string, date: string, paid: 0 | 1) =>
      transaction({
        ...series(pk, { type: 1 }),
        name: "Streaming",
        amount: -50,
        date_created: sec(date),
        paid,
      });
    const bundle = map(
      rawData({
        transactions: [
          occurrence("uuid-a", "2025-11-12", 1),
          occurrence("uuid-b", "2025-12-12", 1),
          occurrence("uuid-c", "2026-01-12", 0),
          // A different subscription that was stopped long ago.
          transaction({
            ...series("uuid-d", { type: 1 }),
            name: "Gym",
            date_created: sec("2025-03-01"),
          }),
        ],
      }),
    );
    expect(bundle.recurringRules).toHaveLength(1);
    expect(bundle.recurringRules[0]).toMatchObject({
      externalId: "recurring:uuid-c",
      title: "Streaming",
      nextDueDate: "2026-01-12",
    });
    expect(byId(bundle, "transaction:uuid-a").recurringRuleExternalId).toBe(
      "recurring:uuid-c",
    );
    expect(byId(bundle, "transaction:uuid-b").recurringRuleExternalId).toBe(
      "recurring:uuid-c",
    );
    expect(warning(bundle, "recurring-ended")?.count).toBe(1);
  });

  it("uses a matching twin category for an income series filed under an expense category", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({
            ...series("p"),
            amount: 900,
            income: 1,
            category_fk: "c1",
            date_created: sec("2026-01-05"),
          }),
          transaction({
            ...series("p::predict::1"),
            amount: 900,
            income: 1,
            category_fk: "c1",
            date_created: sec("2026-02-05"),
            paid: 0,
          }),
        ],
      }),
    );
    expect(bundle.recurringRules[0]).toMatchObject({
      kind: "income",
      categoryExternalId: "category:c1:income",
    });
  });
});

describe("mapCashewBackup budgets", () => {
  it("maps every period type", () => {
    const bundle = map(
      rawData({
        budgets: [
          budget({ budget_pk: "d", reoccurrence: 1, period_length: 2 }),
          budget({ budget_pk: "w", reoccurrence: 2, period_length: 1 }),
          budget({ budget_pk: "m", reoccurrence: 3, period_length: 0 }),
          budget({ budget_pk: "y", reoccurrence: 4, period_length: 1 }),
          budget({
            budget_pk: "c",
            reoccurrence: 0,
            period_length: 9,
            end_date: sec("2026-06-15"),
          }),
        ],
      }),
    );
    const periods = Object.fromEntries(
      bundle.budgets.map((item) => [item.externalId, item.period]),
    );
    expect(periods["budget:d"]).toEqual({
      unit: "day",
      interval: 2,
      anchorDate: "2026-05-01",
      endDate: null,
    });
    expect(periods["budget:w"]).toEqual({
      unit: "week",
      interval: 1,
      anchorDate: "2026-05-01",
      endDate: null,
    });
    expect(periods["budget:m"]).toEqual({
      unit: "month",
      interval: 1,
      anchorDate: "2026-05-01",
      endDate: null,
    });
    expect(periods["budget:y"]).toEqual({
      unit: "year",
      interval: 1,
      anchorDate: "2026-05-01",
      endDate: null,
    });
    expect(periods["budget:c"]).toEqual({
      unit: "custom",
      interval: 1,
      anchorDate: "2026-05-01",
      endDate: "2026-06-15",
    });
    expect(bundle.budgets[0]).toMatchObject({
      limitMinor: 250000,
      icon: "chart.pie",
      categoryExternalIds: [],
      archived: false,
    });
  });

  it("skips invalid budgets", () => {
    const bundle = map(
      rawData({
        budgets: [
          budget({ budget_pk: "zero", amount: 0 }),
          budget({ budget_pk: "neg", amount: -5 }),
          budget({ budget_pk: "nostart", start_date: null }),
          budget({
            budget_pk: "backwards",
            reoccurrence: 0,
            end_date: sec("2026-04-01"),
          }),
          budget({ budget_pk: "noend", reoccurrence: 0, end_date: null }),
          budget({ budget_pk: "ok" }),
        ],
      }),
    );
    expect(bundle.budgets.map((item) => item.externalId)).toEqual([
      "budget:ok",
    ]);
    expect(warning(bundle, "invalid-budget")?.count).toBe(5);
  });

  it("keeps only existing wallets and expense categories", () => {
    const bundle = map(
      rawData({
        wallets: [wallet(), wallet({ wallet_pk: "1", name: "Second" })],
        categories: [
          category(),
          category({ category_pk: "c2", name: "Salary", income: 1 }),
          category({ category_pk: "c3", name: "Bills" }),
        ],
        budgets: [
          budget({
            wallet_fks: '["1","ghost"]',
            category_fks: '["c1","c2","c9"]',
          }),
        ],
      }),
    );
    expect(bundle.budgets[0].accountExternalIds).toEqual(["wallet:1"]);
    expect(bundle.budgets[0].categoryExternalIds).toEqual(["category:c1"]);
  });

  it("flattens an exclude list into an explicit category list", () => {
    const categories = [
      category(),
      category({ category_pk: "c2", name: "Salary", income: 1 }),
      category({ category_pk: "c3", name: "Bills" }),
      category({ category_pk: "c4", name: "Fun" }),
    ];
    const bundle = map(
      rawData({
        categories,
        budgets: [
          budget({ budget_pk: "all-but", category_fks_exclude: '["c3"]' }),
          budget({
            budget_pk: "listed",
            category_fks: '["c1","c3"]',
            category_fks_exclude: '["c3"]',
          }),
        ],
      }),
    );
    expect(bundle.budgets[0].categoryExternalIds).toEqual([
      "category:c1",
      "category:c4",
    ]);
    expect(bundle.budgets[1].categoryExternalIds).toEqual(["category:c1"]);
    expect(warning(bundle, "budget-exclusions-flattened")?.count).toBe(2);
  });

  it("skips a budget that would end up with every category excluded", () => {
    const bundle = map(
      rawData({
        budgets: [budget({ category_fks_exclude: '["c1"]' })],
      }),
    );
    expect(bundle.budgets).toHaveLength(0);
    expect(warning(bundle, "invalid-budget")?.count).toBe(1);
  });

  it('imports category limits and widens an "all" budget so the limits are valid', () => {
    const bundle = map(
      rawData({
        categories: [
          category(),
          category({ category_pk: "c3", name: "Bills" }),
          category({ category_pk: "c2", name: "Salary", income: 1 }),
        ],
        budgets: [budget({ is_absolute_spending_limit: 1 })],
        category_budget_limits: [
          { category_fk: "c1", budget_fk: "b1", amount: 300.5 },
          { category_fk: "c1", budget_fk: "b1", amount: 999 },
          { category_fk: "c2", budget_fk: "b1", amount: 50 },
          { category_fk: "c3", budget_fk: "b1", amount: 0 },
          { category_fk: "c3", budget_fk: "other", amount: 10 },
        ],
      }),
    );
    expect(bundle.budgets[0].categoryLimits).toEqual([
      { categoryExternalId: "category:c1", limitMinor: 30050 },
    ]);
    expect(bundle.budgets[0].categoryExternalIds).toEqual([
      "category:c1",
      "category:c3",
    ]);
  });

  // Cashew's default: category limits are percentages of the budget limit.
  it("converts percentage category limits into amounts of the budget limit", () => {
    const bundle = map(
      rawData({
        categories: [
          category(),
          category({ category_pk: "c3", name: "Bills" }),
          category({
            category_pk: "c1a",
            name: "Pizza",
            main_category_pk: "c1",
          }),
        ],
        // The fixture budget is 2500.00.
        budgets: [budget()],
        category_budget_limits: [
          { category_fk: "c1", budget_fk: "b1", amount: 20 },
          { category_fk: "c3", budget_fk: "b1", amount: 10 },
          // A subcategory's percentage is of its parent's limit: 50% of 20% of 2500.
          { category_fk: "c1a", budget_fk: "b1", amount: 50 },
        ],
      }),
    );
    const caps = Object.fromEntries(
      bundle.budgets[0].categoryLimits.map((entry) => [
        entry.categoryExternalId,
        entry.limitMinor,
      ]),
    );
    expect(caps).toEqual({
      "category:c1": 50000,
      "category:c3": 25000,
      "category:c1a": 25000,
    });
    expect(warning(bundle, "budget-percent-limits")?.count).toBe(1);
  });

  it("reads a subcategory percentage against the whole budget when its parent has no limit", () => {
    const bundle = map(
      rawData({
        categories: [
          category(),
          category({
            category_pk: "c1a",
            name: "Pizza",
            main_category_pk: "c1",
          }),
        ],
        budgets: [budget()],
        category_budget_limits: [
          { category_fk: "c1a", budget_fk: "b1", amount: 10 },
        ],
      }),
    );
    expect(bundle.budgets[0].categoryLimits).toEqual([
      { categoryExternalId: "category:c1a", limitMinor: 25000 },
    ]);
  });

  it("does not import an income budget (a saving goal) as a spending budget", () => {
    const bundle = map(
      rawData({
        budgets: [
          budget({ budget_pk: "spend" }),
          budget({ budget_pk: "save", name: "Saving target", income: 1 }),
        ],
      }),
    );
    expect(bundle.budgets.map((item) => item.externalId)).toEqual([
      "budget:spend",
    ]);
    expect(warning(bundle, "budget-income-skipped")?.count).toBe(1);
  });

  it("reports each dropped budget feature with the number of budgets affected", () => {
    const bundle = map(
      rawData({
        budgets: [
          budget({
            budget_pk: "a",
            budget_transaction_filters: "[3]",
            shared_key: "k",
            added_transactions_only: 1,
          }),
          budget({
            budget_pk: "b",
            is_absolute_spending_limit: 1,
            shared_key: "k2",
            budget_transaction_filters: "[]",
          }),
          budget({ budget_pk: "c" }),
        ],
      }),
    );
    expect(warning(bundle, "budget-filters-dropped")?.count).toBe(1);
    expect(warning(bundle, "shared-budget-flattened")?.count).toBe(2);
    expect(warning(bundle, "budget-manual-only")?.count).toBe(1);
    expect(warning(bundle, "budget-percent-limits")).toBeUndefined();
    expect(warning(bundle, "budget-currency")).toBeUndefined();
  });

  it("warns when account currencies differ from the currency limits are read in", () => {
    const bundle = map(
      rawData({
        wallets: [
          wallet(),
          wallet({ wallet_pk: "1", name: "Dollars", currency: "usd" }),
        ],
        budgets: [budget()],
      }),
    );
    expect(warning(bundle, "budget-currency")?.count).toBe(1);
  });
});

describe("mapCashewBackup time zones", () => {
  const late = Date.UTC(2026, 6, 31, 23, 30) / 1000;
  const raw = () =>
    rawData({ transactions: [transaction({ date_created: late })] });

  it("converts the same instant to the local calendar day of the chosen zone", () => {
    const jerusalem = map(raw(), {
      ...OPTIONS,
      fallbackTimeZone: "Asia/Jerusalem",
    });
    const newYork = map(raw(), {
      ...OPTIONS,
      fallbackTimeZone: "America/New_York",
    });
    expect(jerusalem.transactions[0].localDate).toBe("2026-08-01");
    expect(newYork.transactions[0].localDate).toBe("2026-07-31");
    expect(jerusalem).toMatchObject({
      timeZone: "Asia/Jerusalem",
      timeZoneSource: "device",
    });
  });

  it("prefers the backup zone over the device zone", () => {
    const bundle = map(
      rawData(
        { transactions: [transaction({ date_created: late })] },
        { detectedTimeZone: "America/New_York" },
      ),
    );
    expect(bundle.transactions[0].localDate).toBe("2026-07-31");
    expect(bundle).toMatchObject({
      timeZone: "America/New_York",
      timeZoneSource: "backup",
    });
  });

  it("rejects an unsupported zone", () => {
    expect(() =>
      mapCashewBackup(raw(), { ...OPTIONS, fallbackTimeZone: "Not/AZone" }),
    ).toThrow(ImportError);
    try {
      mapCashewBackup(raw(), { ...OPTIONS, fallbackTimeZone: "Not/AZone" });
    } catch (error) {
      expect((error as ImportError).code).toBe("unsupported");
    }
  });
});

describe("mapCashewBackup tolerance and determinism", () => {
  it("reads older backups that lack optional columns and tables, and numbers stored as text", () => {
    const bundle = map({
      userVersion: 10,
      detectedTimeZone: null,
      tables: {
        wallets: [{ wallet_pk: "0" }],
        categories: [{ category_pk: "c1" }],
        transactions: [
          {
            transaction_pk: "t1",
            wallet_fk: "0",
            amount: "12.5",
            paid: "1",
            date_created: String(sec("2026-05-10")),
            category_fk: "c1",
          },
          {
            transaction_pk: "t2",
            wallet_fk: "0",
            amount: -3,
            paid: 1,
            date_created: sec("2026-05-11"),
          },
        ],
      },
    });
    expect(bundle.accounts[0]).toMatchObject({
      name: "Account",
      currency: "ILS",
    });
    expect(bundle.categories[0]).toMatchObject({
      name: "Category",
      kind: "expense",
    });
    expect(
      bundle.transactions.map((item) => [
        item.kind,
        item.amountMinor,
        item.status,
      ]),
    ).toEqual([
      ["income", 1250, "posted"],
      ["expense", 300, "posted"],
    ]);
    // The positive amount sits in an expense category, so it needed a twin.
    expect(bundle.transactions[0].categoryExternalId).toBe(
      "category:c1:income",
    );
    expect(bundle.budgets).toEqual([]);
  });

  it("produces identical output for identical input", () => {
    const input = rawData({
      transactions: [
        transaction({
          transaction_pk: "a",
          amount: 50,
          income: 1,
          category_fk: "c1",
        }),
        transaction({
          ...{ type: 2, reoccurrence: 3, period_length: 1 },
          transaction_pk: "r",
          date_created: sec("2026-01-05"),
        }),
        transaction({
          ...{ type: 2, reoccurrence: 3, period_length: 1 },
          transaction_pk: "r::predict::1",
          date_created: sec("2026-02-05"),
          paid: 0,
        }),
      ],
      budgets: [budget()],
    });
    expect(mapCashewBackup(input, OPTIONS)).toEqual(
      mapCashewBackup(input, OPTIONS),
    );
  });

  it("orders warnings by count then code", () => {
    const bundle = map(
      rawData({
        transactions: [
          transaction({ transaction_pk: "a", amount: 0 }),
          transaction({ transaction_pk: "b", amount: 0 }),
          transaction({ transaction_pk: "c", amount: "x" }),
          transaction({ transaction_pk: "d", date_created: null }),
        ],
      }),
    );
    expect(
      bundle.report.warnings.map((item) => [item.code, item.count]),
    ).toEqual([
      ["zero-amount", 2],
      ["invalid-amount", 1],
      ["invalid-date", 1],
    ]);
    bundle.report.warnings.forEach((item) =>
      expect(item.message.length).toBeGreaterThan(10),
    );
    expect(bundle.report.counts).toEqual({
      accounts: 1,
      categories: 2,
      tags: 0,
      transactions: 0,
      recurringRules: 0,
      budgets: 0,
    });
  });
});

describe("reconcileBalances", () => {
  const account = (externalId: string): BundleAccount => ({
    externalId,
    name: externalId,
    type: "checking",
    currency: "ILS",
    openingBalanceMinor: 0,
    icon: "wallet",
    color: "#000000",
    archived: false,
  });
  const tx = (overrides: Partial<BundleTransaction>): BundleTransaction => ({
    externalId: "x",
    kind: "expense",
    status: "posted",
    title: "t",
    note: "",
    localDate: "2026-01-01",
    accountExternalId: "a",
    destinationAccountExternalId: null,
    categoryExternalId: null,
    tagExternalIds: [],
    amountMinor: 100,
    destinationAmountMinor: null,
    recurringRuleExternalId: null,
    ...overrides,
  });

  it("accepts equal balances, counting only posted rows and both legs of a transfer", () => {
    const checks = reconcileBalances(
      [account("a"), account("b")],
      [
        tx({ kind: "income", amountMinor: 1000 }),
        tx({ amountMinor: 250 }),
        tx({ status: "upcoming", amountMinor: 9999 }),
        tx({
          kind: "transfer",
          amountMinor: 300,
          destinationAccountExternalId: "b",
          destinationAmountMinor: 80,
        }),
      ],
      new Map([
        ["a", 450],
        ["b", 80],
      ]),
    );
    expect(
      checks.map((item) => [
        item.sourceBalanceMinor,
        item.importedBalanceMinor,
      ]),
    ).toEqual([
      [450, 450],
      [80, 80],
    ]);
  });

  it("refuses the import on any mismatch", () => {
    const attempt = () =>
      reconcileBalances(
        [account("a")],
        [tx({ amountMinor: 100 })],
        new Map([["a", -101]]),
      );
    expect(attempt).toThrow(ImportError);
    try {
      attempt();
    } catch (error) {
      expect((error as ImportError).code).toBe("reconciliation-failed");
      expect((error as ImportError).message).toBe(
        "Account balances did not match the backup, so nothing was imported.",
      );
    }
  });
});

describe("mapCashewCategoryIcon", () => {
  it("maps common Cashew icon names and falls back by kind", () => {
    expect(mapCashewCategoryIcon("cupcake.png", "expense")).toBe("fork.knife");
    expect(mapCashewCategoryIcon("shopping.png", "expense")).toBe("cart");
    expect(mapCashewCategoryIcon("money.png", "income")).toBe("banknote");
    expect(mapCashewCategoryIcon("piggy-bank.png", "expense")).toBe("leaf");
    expect(mapCashewCategoryIcon("laptop.png", "expense")).toBe(
      "laptopcomputer",
    );
    expect(mapCashewCategoryIcon("clock.png", "expense")).toBe("repeat");
    expect(mapCashewCategoryIcon("atm-machine(2).png", "expense")).toBe(
      "banknote",
    );
    expect(mapCashewCategoryIcon("popcorn.png", "expense")).toBe("sparkles");
    expect(mapCashewCategoryIcon("gamepad.png", "expense")).toBe("sparkles");
    expect(mapCashewCategoryIcon("safety-helmet.png", "expense")).toBe("house");
    expect(mapCashewCategoryIcon("image.png", "expense")).toBe("sparkles");
    expect(mapCashewCategoryIcon("image.png", "income")).toBe("plus.circle");
    expect(mapCashewCategoryIcon(null, "income")).toBe("plus.circle");
  });
});

const realBackupPath = process.env.CASHEW_BACKUP_PATH;
(realBackupPath ? describe : describe.skip)(
  "real Cashew backup (CASHEW_BACKUP_PATH)",
  () => {
    it("imports and reconciles without throwing", () => {
      const bundle = parseExternalBackup(
        "cashew",
        fs.readFileSync(realBackupPath as string),
        OPTIONS,
      );
      console.log(
        JSON.stringify({
          counts: bundle.report.counts,
          warnings: bundle.report.warnings.map(
            (item) => `${item.code}:${item.count}`,
          ),
          timeZoneSource: bundle.timeZoneSource,
        }),
      );
      expect(bundle.report.counts.accounts).toBe(1);
      bundle.report.balanceChecks.forEach((check) =>
        expect(check.importedBalanceMinor).toBe(check.sourceBalanceMinor),
      );
    });
  },
);
