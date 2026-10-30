import type { Category } from "@/domain/models";

/**
 * The categories with each parent followed by its children, keeping the given order among
 * siblings. A category whose parent is not in the list (deleted, archived) stands as a top-level
 * one, so nothing is dropped. A parent cycle, which no local mutation can create, is cut rather
 * than looped over.
 */
export function orderCategoriesByParent<
  T extends Pick<Category, "id" | "parentId">,
>(categories: readonly T[]): T[] {
  const ids = new Set(categories.map((item) => item.id));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const category of categories) {
    if (
      category.parentId &&
      category.parentId !== category.id &&
      ids.has(category.parentId)
    ) {
      const siblings = childrenOf.get(category.parentId) ?? [];
      siblings.push(category);
      childrenOf.set(category.parentId, siblings);
    } else roots.push(category);
  }
  const ordered: T[] = [];
  const seen = new Set<string>();
  const visit = (category: T) => {
    if (seen.has(category.id)) return;
    seen.add(category.id);
    ordered.push(category);
    for (const child of childrenOf.get(category.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  // Members of a parent cycle have no root above them: append them as they come.
  for (const category of categories) visit(category);
  return ordered;
}
