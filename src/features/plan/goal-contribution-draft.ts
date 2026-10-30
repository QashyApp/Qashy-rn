import type { GoalContribution } from "@/domain/models";

export interface ContributionFields {
  contribution: string;
  contributionDate: string;
  contributionNote: string;
}

/**
 * The part of the goal form's contribution card that counts as unsaved work, or `null` when it
 * holds none. A new contribution is only pending once an amount is typed (the date and note are
 * saved with an amount, never alone). One being edited is pending only once a field differs from
 * the contribution as stored, so opening it and going back asks nothing. `storedAmountText` is
 * that stored amount in the form's own text format.
 */
export function pendingContributionDraft(
  fields: ContributionFields,
  editing: Pick<GoalContribution, "id" | "localDate" | "note"> | null,
  storedAmountText: string | null,
): (ContributionFields & { editingId: string | null }) | null {
  if (editing) {
    const unchanged =
      fields.contribution === storedAmountText &&
      fields.contributionDate === editing.localDate &&
      fields.contributionNote === editing.note;
    return unchanged ? null : { ...fields, editingId: editing.id };
  }
  return fields.contribution.trim() ? { ...fields, editingId: null } : null;
}
