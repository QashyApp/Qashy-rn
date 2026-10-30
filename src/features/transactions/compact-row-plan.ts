/** What one compact pill's text needs at its natural size, in px. */
export interface PillNeeds {
  /** The label at its normal size. */
  label: number;
  /** The label at the smaller size. */
  smallLabel: number;
  /** The figure, which is never cut. */
  amount: number;
}

/**
 * The least a label may be cut down to, in px: about three letters. Below that "Net" is a stray
 * glyph, and the colour of its figure would be all that is left to say what it is.
 */
export const MIN_CUT_LABEL = 32;

/**
 * How the compact Income / Spent / Net row is laid out, from the widest form that fits.
 *
 * - `full`: each pill as wide as its own text needs, the label at its normal size.
 * - `small`: the same with the labels a step smaller.
 * - `cut`: the labels a step smaller and ellipsized (to `MIN_CUT_LABEL` at the least), the figures
 *   keeping their room.
 * - `stacked`: the figures and a readable label cannot share the row side by side, so each pill
 *   becomes an equal third with its label above its figure and nothing is cut.
 *
 * `chrome` is a pill's padding, the gap between its label and figure and a little slack; `gap` is
 * the space between pills.
 */
export type CompactRowForm = "full" | "small" | "cut" | "stacked";

export function planCompactRow(
  needs: readonly PillNeeds[],
  rowWidth: number,
  chrome: number,
  gap: number,
): CompactRowForm {
  if (!needs.length || rowWidth <= 0) return "full";
  const between = gap * (needs.length - 1);
  const total = (label: (need: PillNeeds) => number) =>
    needs.reduce(
      (sum, need) => sum + chrome + label(need) + need.amount,
      between,
    );
  if (total((need) => need.label) <= rowWidth) return "full";
  if (total((need) => need.smallLabel) <= rowWidth) return "small";
  if (total((need) => Math.min(need.smallLabel, MIN_CUT_LABEL)) <= rowWidth)
    return "cut";
  return "stacked";
}
