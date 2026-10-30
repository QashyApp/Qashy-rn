import { orderCategoriesByParent } from "@/utils/category-order";

const cat = (id: string, parentId: string | null = null) => ({ id, parentId });

describe("orderCategoriesByParent", () => {
  it("puts each parent before its children and keeps sibling order", () => {
    const list = [
      cat("child-a", "food"),
      cat("rent"),
      cat("food"),
      cat("child-b", "food"),
      cat("grandchild", "child-a"),
    ];
    expect(orderCategoriesByParent(list).map((item) => item.id)).toEqual([
      "rent",
      "food",
      "child-a",
      "grandchild",
      "child-b",
    ]);
  });

  it("treats a child whose parent is missing as top-level and survives cycles", () => {
    expect(
      orderCategoriesByParent([
        cat("orphan", "gone"),
        cat("a", "b"),
        cat("b", "a"),
      ]).map((item) => item.id),
    ).toEqual(["orphan", "a", "b"]);
  });
});
