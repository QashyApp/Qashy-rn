/**
 * Pure helpers for `LocalFinanceRepository.importExternalBundle`.
 *
 * Kept out of the repository because none of them read repository state: they are name and
 * ordering rules that the tests can exercise directly.
 */

import type { ImportCounts, ImportSourceId } from "@/data/import/types";
import { normalizeName } from "@/utils/naming";

/** How a source is named in the suffix added to a colliding entity, e.g. "Food (Cashew)". */
const SOURCE_LABELS: Record<ImportSourceId, string> = {
  cashew: "Cashew",
};

export const emptyImportCounts = (): ImportCounts => ({
  accounts: 0,
  categories: 0,
  tags: 0,
  transactions: 0,
  recurringRules: 0,
  budgets: 0,
});

/**
 * `name` made unique against `taken` (already normalised names) by appending the source label.
 *
 * Suffixing, not merging, because a same-named entity that is not compatible (a category of
 * the other kind, an account in another currency) is a different thing the user has to be
 * able to tell apart. The result is compared with `normalizeName`, the same rule the
 * repository's uniqueness check uses, so a name accepted here is never rejected on save.
 */
export function uniquifyName(
  source: ImportSourceId,
  name: string,
  taken: ReadonlySet<string>,
): string {
  const base = name.trim();
  if (!taken.has(normalizeName(base))) return base;
  const label = SOURCE_LABELS[source];
  let index = 1;
  let candidate = "";
  do {
    candidate = `${base} (${label}${index === 1 ? "" : ` ${index}`})`;
    index += 1;
  } while (taken.has(normalizeName(candidate)));
  return candidate;
}

/**
 * The bundle's categories with every parent ahead of its children.
 *
 * A backup's order is whatever the source database returned, so a child can precede its
 * parent. A category whose parent is not in the bundle, or that sits on a cycle, is kept (at
 * the point it is reached) rather than dropped: validation then rejects it with a reason
 * instead of the import silently losing a row.
 */
export function orderParentsFirst<
  T extends { externalId: string; parentExternalId: string | null },
>(categories: readonly T[]): T[] {
  const byId = new Map(
    categories.map((category) => [category.externalId, category]),
  );
  const ordered: T[] = [];
  const visited = new Set<string>();
  const visit = (category: T, path: Set<string>) => {
    if (visited.has(category.externalId)) return;
    visited.add(category.externalId);
    const parent = category.parentExternalId
      ? byId.get(category.parentExternalId)
      : undefined;
    if (parent && !path.has(parent.externalId))
      visit(parent, new Set([...path, category.externalId]));
    ordered.push(category);
  };
  for (const category of categories) visit(category, new Set());
  return ordered;
}
