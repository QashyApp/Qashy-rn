import { omitArchived } from "@/data/import/omit-archived";
import type {
  BundleAccount,
  BundleBudget,
  BundleCategory,
} from "@/data/import/types";

const account = (externalId: string, archived = false): BundleAccount => ({
  externalId,
  name: externalId,
  type: "checking",
  currency: "USD",
  openingBalanceMinor: 0,
  icon: "wallet.bifold",
  color: "#123456",
  archived,
});

const category = (externalId: string, archived = false): BundleCategory => ({
  externalId,
  name: externalId,
  kind: "expense",
  icon: "tag",
  color: "#123456",
  parentExternalId: null,
  archived,
});

const budget = (overrides: Partial<BundleBudget> = {}): BundleBudget => ({
  externalId: "budget",
  name: "Budget",
  icon: "chart",
  color: "#5966E9",
  limitMinor: 1000,
  period: {
    unit: "month",
    interval: 1,
    anchorDate: "2026-06-01",
    endDate: null,
  },
  accountExternalIds: [],
  categoryExternalIds: [],
  tagExternalIds: [],
  categoryLimits: [],
  archived: false,
  ...overrides,
});

const parts = (budgets: BundleBudget[]) => ({
  accounts: [account("live"), account("gone", true)],
  categories: [category("food"), category("old", true)],
  transactions: [],
  recurringRules: [],
  budgets,
});

describe("omitArchived budgets", () => {
  it("keeps a budget whose accounts and categories were partly archived, filtering both", () => {
    const { parts: out, omitted } = omitArchived(
      parts([
        budget({
          accountExternalIds: ["gone", "live"],
          categoryExternalIds: ["old", "food"],
        }),
      ]),
    );
    expect(out.budgets).toHaveLength(1);
    expect(out.budgets[0].accountExternalIds).toEqual(["live"]);
    expect(out.budgets[0].categoryExternalIds).toEqual(["food"]);
    expect(omitted.budgets).toBe(0);
  });

  it("keeps a budget whose only account is archived, now covering every account", () => {
    // Mixed: the account list empties while a live category keeps its filter.
    const { parts: out, omitted } = omitArchived(
      parts([
        budget({
          accountExternalIds: ["gone"],
          categoryExternalIds: ["food"],
        }),
      ]),
    );
    expect(out.budgets).toHaveLength(1);
    expect(out.budgets[0].accountExternalIds).toEqual([]);
    expect(out.budgets[0].categoryExternalIds).toEqual(["food"]);
    expect(omitted.budgets).toBe(0);
  });

  it("keeps an accounts-only budget whose accounts are all archived, unfiltered", () => {
    const { parts: out, omitted } = omitArchived(
      parts([budget({ accountExternalIds: ["gone"] })]),
    );
    expect(out.budgets.map((item) => item.accountExternalIds)).toEqual([[]]);
    expect(omitted.budgets).toBe(0);
  });

  it("empties only the category filter when every category is archived", () => {
    const { parts: out } = omitArchived(
      parts([
        budget({
          accountExternalIds: ["live"],
          categoryExternalIds: ["old"],
          categoryLimits: [
            { categoryExternalId: "old", limitMinor: 100 },
            { categoryExternalId: "food", limitMinor: 200 },
          ],
        }),
      ]),
    );
    expect(out.budgets[0].accountExternalIds).toEqual(["live"]);
    expect(out.budgets[0].categoryExternalIds).toEqual([]);
    expect(out.budgets[0].categoryLimits).toEqual([
      { categoryExternalId: "food", limitMinor: 200 },
    ]);
  });

  it("drops only a budget that is itself archived", () => {
    const { parts: out, omitted } = omitArchived(
      parts([
        budget({ externalId: "dead", archived: true }),
        budget({ externalId: "alive", accountExternalIds: ["gone"] }),
      ]),
    );
    expect(out.budgets.map((item) => item.externalId)).toEqual(["alive"]);
    expect(omitted.budgets).toBe(1);
  });
});
