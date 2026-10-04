import type { Category, TransactionRecord } from "@/domain/models";
import {
  buildTitleCategoryIndex,
  normalizeTitle,
  suggestCategoryForTitle,
} from "@/features/transactions/form/title-category";

function tx(
  title: string,
  categoryId: string | null,
  localDate: string,
  extra: Partial<TransactionRecord> = {},
) {
  return {
    kind: "expense",
    status: "posted",
    title,
    categoryId,
    localDate,
    deletedAt: null,
    ...extra,
  } as TransactionRecord;
}

const categories = [
  { id: "coffee", kind: "expense", archived: false },
  { id: "food", kind: "expense", archived: false },
  { id: "old", kind: "expense", archived: true },
  { id: "salary", kind: "income", archived: false },
] as Pick<Category, "id" | "kind" | "archived">[];

describe("normalizeTitle", () => {
  it("ignores case, outer spacing and repeated spaces", () => {
    expect(normalizeTitle("  Star   BUCKS ")).toBe("star bucks");
  });
});

describe("suggestCategoryForTitle", () => {
  it("suggests the category a title was most often filed under", () => {
    const index = buildTitleCategoryIndex([
      tx("Starbucks", "coffee", "2026-01-01"),
      tx("starbucks", "coffee", "2026-01-02"),
      tx("Starbucks", "food", "2026-01-03"),
    ]);
    expect(
      suggestCategoryForTitle(index, " STARBUCKS", "expense", categories),
    ).toBe("coffee");
  });

  it("breaks a tie toward the more recent use", () => {
    const index = buildTitleCategoryIndex([
      tx("Lunch", "coffee", "2026-01-01"),
      tx("Lunch", "food", "2026-02-01"),
    ]);
    expect(suggestCategoryForTitle(index, "Lunch", "expense", categories)).toBe(
      "food",
    );
  });

  it("returns null for a new or empty title", () => {
    const index = buildTitleCategoryIndex([tx("Rent", "food", "2026-01-01")]);
    expect(
      suggestCategoryForTitle(index, "Gym", "expense", categories),
    ).toBeNull();
    expect(
      suggestCategoryForTitle(index, "  ", "expense", categories),
    ).toBeNull();
  });

  it("keeps expense and income apart", () => {
    const index = buildTitleCategoryIndex([
      tx("Refund", "food", "2026-01-01"),
      tx("Refund", "salary", "2026-01-02", { kind: "income" }),
    ]);
    expect(suggestCategoryForTitle(index, "Refund", "income", categories)).toBe(
      "salary",
    );
    expect(
      suggestCategoryForTitle(index, "Refund", "expense", categories),
    ).toBe("food");
  });

  it("never suggests an archived or unknown category", () => {
    const index = buildTitleCategoryIndex([
      tx("Tea", "old", "2026-03-01"),
      tx("Tea", "gone", "2026-03-02"),
      tx("Tea", "coffee", "2026-01-01"),
    ]);
    expect(suggestCategoryForTitle(index, "Tea", "expense", categories)).toBe(
      "coffee",
    );
  });

  it("ignores deleted, skipped, transfer and uncategorized rows", () => {
    const index = buildTitleCategoryIndex([
      tx("Cafe", "coffee", "2026-01-01", { deletedAt: "2026-01-02T00:00:00Z" }),
      tx("Cafe", "coffee", "2026-01-01", { status: "skipped" }),
      tx("Cafe", "coffee", "2026-01-01", { kind: "transfer" }),
      tx("Cafe", null, "2026-01-01"),
    ]);
    expect(
      suggestCategoryForTitle(index, "Cafe", "expense", categories),
    ).toBeNull();
  });
});
