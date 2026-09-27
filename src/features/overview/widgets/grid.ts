/**
 * Pure row-packing for the Overview grid. Kept separate from the screen so the packing math
 * (which card gets which pixel width, and which row it lands in) can be unit tested without a
 * renderer.
 *
 * Below 900px content width every card is full width, one per row — there is no room for a
 * side-by-side layout. At 900px and above the content area is a 6-column flow: `wide` cards
 * take all 6 columns, `regular` takes 3 (half), `compact` takes 2 (a third). Cards are packed
 * greedily in list order: a card starts a new row only when it would not fit in the columns
 * remaining on the current one.
 */

import type { OverviewCard, WidgetSize } from '@/features/overview/layout/overview-layout';

export const GRID_BREAKPOINT = 900;
const TOTAL_COLUMNS = 6;

const COLUMN_UNITS: Record<WidgetSize, number> = {
  wide: 6,
  regular: 3,
  compact: 2,
};

export interface PackedCard {
  readonly id: string;
  readonly card: OverviewCard;
  readonly width: number;
}

export interface PackedRow {
  readonly cards: readonly PackedCard[];
}

export interface PackOverviewRowsOptions {
  /**
   * Whether to use the 6-column flow at all. Defaults to `layoutWidth >= GRID_BREAKPOINT`, but
   * the caller may know a wider number for this decision than the pixel width it wants cards
   * measured against — see `layoutWidth` below.
   */
  multiColumn?: boolean;
}

/**
 * `layoutWidth` is the pixel width cards are actually sized against (typically the measured
 * width of the card-stack container itself, since a screen's `contentWidth` can be wider than
 * the box laid out inside it — see `ScreenContainer`'s own max-width cap). `gap` is the space
 * between cards, both horizontally within a row and (by convention of the caller) between rows.
 *
 * Whether the grid goes single-column or 6-column flow is a *product* decision the caller may
 * want to base on a different, larger number (`useScreenMetrics().contentWidth`) than the pixel
 * budget cards are packed into — pass `multiColumn` explicitly to decouple the two. Column math
 * is always floored and always computed from `layoutWidth`, so pixel widths never exceed the
 * container regardless of which number decided the column count.
 */
export function packOverviewRows(
  cards: readonly OverviewCard[],
  layoutWidth: number,
  gap: number,
  options: PackOverviewRowsOptions = {},
): PackedRow[] {
  if (cards.length === 0) return [];

  const multiColumn = options.multiColumn ?? layoutWidth >= GRID_BREAKPOINT;

  if (!multiColumn) {
    return cards.map((card) => ({
      cards: [{ id: card.id, card, width: layoutWidth }],
    }));
  }

  const columnWidth = (layoutWidth - gap * (TOTAL_COLUMNS - 1)) / TOTAL_COLUMNS;
  const widthForUnits = (units: number) => Math.floor(units * columnWidth + (units - 1) * gap);

  const rows: PackedRow[] = [];
  let currentRow: PackedCard[] = [];
  let currentUnits = 0;

  for (const card of cards) {
    const units = Math.min(COLUMN_UNITS[card.size] ?? TOTAL_COLUMNS, TOTAL_COLUMNS);
    if (currentRow.length > 0 && currentUnits + units > TOTAL_COLUMNS) {
      rows.push({ cards: currentRow });
      currentRow = [];
      currentUnits = 0;
    }
    currentRow.push({ id: card.id, card, width: widthForUnits(units) });
    currentUnits += units;
  }
  if (currentRow.length > 0) rows.push({ cards: currentRow });

  return rows;
}
