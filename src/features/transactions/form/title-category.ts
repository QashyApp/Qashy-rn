import type { Category, TransactionRecord } from "@/domain/models";

type Kind = "expense" | "income";

interface Tally {
  count: number;
  /** `localDate` of the newest transaction with this title and category. */
  latest: string;
}

/**
 * What the user has already filed under each title, built from the ledger itself.
 *
 * Nothing here is stored: the suggestion is a function of existing transactions, so it needs no
 * entity, no sync registry entry and no migration, and it follows the ledger the moment a
 * transaction is edited or deleted.
 */
export type TitleCategoryIndex = ReadonlyMap<
  string,
  ReadonlyMap<string, Tally>
>;

/** Titles match regardless of case, accents' composition, and surrounding or repeated spaces. */
export function normalizeTitle(title: string) {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const keyOf = (kind: Kind, title: string) => `${kind}|${normalizeTitle(title)}`;

export function buildTitleCategoryIndex(
  transactions: readonly TransactionRecord[],
): TitleCategoryIndex {
  const index = new Map<string, Map<string, Tally>>();
  for (const transaction of transactions) {
    // Tombstones are erased of their title, and a skipped item was never really filed.
    if (transaction.deletedAt || transaction.status === "skipped") continue;
    if (transaction.kind === "transfer" || !transaction.categoryId) continue;
    if (!transaction.title.trim()) continue;
    const key = keyOf(transaction.kind, transaction.title);
    let tallies = index.get(key);
    if (!tallies) {
      tallies = new Map();
      index.set(key, tallies);
    }
    const tally = tallies.get(transaction.categoryId);
    if (!tally) {
      tallies.set(transaction.categoryId, {
        count: 1,
        latest: transaction.localDate,
      });
    } else {
      tally.count += 1;
      if (transaction.localDate > tally.latest)
        tally.latest = transaction.localDate;
    }
  }
  return index;
}

/**
 * The category this title has most often been filed under for this kind, or null when the title is
 * new. Ties go to the more recent use. Only categories the form could actually offer are suggested,
 * so a title last used with a since-archived category does not silently pick it.
 */
export function suggestCategoryForTitle(
  index: TitleCategoryIndex,
  title: string,
  kind: Kind,
  categories: readonly Pick<Category, "id" | "kind" | "archived">[],
): string | null {
  if (!title.trim()) return null;
  const tallies = index.get(keyOf(kind, title));
  if (!tallies) return null;
  const offered = new Set(
    categories
      .filter((category) => category.kind === kind && !category.archived)
      .map((category) => category.id),
  );
  let best: { id: string; tally: Tally } | null = null;
  for (const [id, tally] of tallies) {
    if (!offered.has(id)) continue;
    if (
      !best ||
      tally.count > best.tally.count ||
      (tally.count === best.tally.count && tally.latest > best.tally.latest)
    ) {
      best = { id, tally };
    }
  }
  return best?.id ?? null;
}
