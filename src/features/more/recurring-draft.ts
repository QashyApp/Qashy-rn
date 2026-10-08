import type { CategoryKind } from "@/domain/models";
import { makeId } from "@/utils/entity";

/**
 * One-navigation, in-memory handoff from a transaction draft to the recurring form.
 *
 * Finance data must never enter a route query. The opaque token is harmless if a browser keeps
 * it in history, while the values live only until the destination screen consumes them.
 */
export interface RecurringDraft {
  readonly kind: CategoryKind;
  readonly title: string;
  readonly amount: string;
  readonly accountId: string;
  readonly categoryId: string;
  /** Foreign-currency code, when the source transaction drafted a foreign amount. */
  readonly foreignCurrency?: string;
  readonly feeKind?: "none" | "percent" | "fixed";
  readonly feeValue?: string;
}

const drafts = new Map<string, RecurringDraft>();

export const stashRecurringDraft = (draft: RecurringDraft): string => {
  const id = makeId();
  drafts.set(id, draft);
  return id;
};

/**
 * Reads a draft without consuming it. Safe to call during render: React may run a render or a
 * state initializer more than once (StrictMode), and every run must see the same draft.
 */
export const peekRecurringDraft = (
  id: string | undefined,
): RecurringDraft | null => (id ? (drafts.get(id) ?? null) : null);

/**
 * Consumes a draft. Call once, from an effect, after the form has taken its values: the draft is
 * single use, and a render must not delete it.
 */
export const takeRecurringDraft = (
  id: string | undefined,
): RecurringDraft | null => {
  if (!id) return null;
  const draft = drafts.get(id) ?? null;
  drafts.delete(id);
  return draft;
};
