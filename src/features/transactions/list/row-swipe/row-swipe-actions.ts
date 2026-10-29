import type { TransactionRecord } from "@/domain/models";
import type { RowSwipeSide } from "@/features/transactions/list/row-swipe/resolve-row-swipe";
import type { ColorValue } from "react-native";

import type { ThemeTokens } from "@/theme/theme";

/** What a swipe, a revealed button or an accessibility action can do to one row. */
export type RowSwipeActionKind =
  "changeCategory" | "delete" | "skip" | "markPaid";

export interface RowSwipeActions {
  start: RowSwipeActionKind | null;
  end: RowSwipeActionKind | null;
}

/**
 * The actions a row offers, by side. A posted row changes category toward the start and deletes
 * toward the end; a transfer has no category, so its start side is empty. An upcoming row marks
 * paid toward the start and skips toward the end.
 */
export function rowSwipeActions(
  transaction: Pick<TransactionRecord, "kind" | "status">,
): RowSwipeActions {
  if (transaction.status === "upcoming")
    return { start: "markPaid", end: "skip" };
  return {
    start: transaction.kind === "transfer" ? null : "changeCategory",
    end: "delete",
  };
}

/**
 * Whether the action takes the row out of the list (so it slides away) or leaves it in place.
 * Marking paid keeps the same transaction (it only becomes posted), so its row springs back and
 * re-renders as posted rather than sliding out and in again.
 */
export function actionLeavesList(kind: RowSwipeActionKind): boolean {
  return kind === "delete" || kind === "skip";
}

export interface RowSwipeActionVisual {
  /** English key for `t()`; the existing label of the same action elsewhere in the app. */
  label: string;
  icon: string;
  background: ColorValue;
  foreground: ColorValue;
}

const LABELS: Record<RowSwipeActionKind, string> = {
  changeCategory: "Change category",
  delete: "Delete",
  skip: "Skip",
  markPaid: "Mark paid",
};

const ICONS: Record<RowSwipeActionKind, string> = {
  changeCategory: "ion:pricetag-outline",
  delete: "trash",
  skip: "ion:play-skip-forward-outline",
  markPaid: "checkmark",
};

export function rowSwipeActionLabel(kind: RowSwipeActionKind): string {
  return LABELS[kind];
}

/** Colors come from the theme's semantic roles; Skip takes the warning pair, as a mild interruption. */
export function rowSwipeActionVisual(
  kind: RowSwipeActionKind,
  theme: Pick<
    ThemeTokens,
    | "accent"
    | "onAccent"
    | "negative"
    | "onNegative"
    | "positive"
    | "onPositive"
    | "warning"
    | "onWarning"
  >,
): RowSwipeActionVisual {
  const colors = {
    changeCategory: [theme.accent, theme.onAccent],
    delete: [theme.negative, theme.onNegative],
    skip: [theme.warning, theme.onWarning],
    markPaid: [theme.positive, theme.onPositive],
  }[kind];
  return {
    label: LABELS[kind],
    icon: ICONS[kind],
    background: colors[0],
    foreground: colors[1],
  };
}

/** The side that carries `kind` for a row, or null when it does not. */
export function sideOfAction(
  actions: RowSwipeActions,
  kind: RowSwipeActionKind,
): RowSwipeSide | null {
  return actions.start === kind ? "start" : actions.end === kind ? "end" : null;
}
