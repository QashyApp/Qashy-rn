import { createContext, use, useCallback, useMemo } from "react";

import {
  rowActionErrorTitle,
  usePendingRowActions,
  type PendingRowAction,
  type RowActionKind,
} from "@/features/transactions/row-actions";
import { hapticSelection, hapticSuccess } from "@/services/haptics";
import { errorMessage, showError } from "@/utils/confirm";

/** The two things the Coming up card can do to a scheduled payment. */
export type UpcomingActionKind = Extract<RowActionKind, "skip" | "markPaid">;

export interface UpcomingActions {
  /** Rows to leave out of the card: skipped payments waiting on Undo or committing. */
  hiddenIds: ReadonlySet<string>;
  /** Rows being marked paid (waiting on Undo or committing); the card no longer lists them. */
  paidIds: ReadonlySet<string>;
  /** Defers the action behind the Overview's Undo bar; a repeat on the same row does nothing. */
  resolve(id: string, kind: UpcomingActionKind): void;
}

/** Provided by the Overview screen, which owns the one queue and its one Undo bar. */
export const UpcomingActionsContext = createContext<UpcomingActions | null>(
  null,
);

export function useUpcomingActions(): UpcomingActions {
  const actions = use(UpcomingActionsContext);
  if (!actions)
    throw new Error("useUpcomingActions must be used inside OverviewScreen.");
  return actions;
}

// Module scope, so `usePendingRowActions` sees one stable handler.
function reportCommitError(kind: RowActionKind, reason: unknown) {
  showError(rowActionErrorTitle(kind), errorMessage(reason, "Try again."));
}

/**
 * The Overview screen's side of the Coming up card: the same deferred, undoable skip and mark-paid
 * the Transactions list has (`usePendingRowActions`), so a mistaken tap on the card can be taken
 * back instead of being final. The screen renders `pending` in its Undo bar and calls `undo`.
 */
export function useUpcomingRowActions(): {
  actions: UpcomingActions;
  pending: readonly PendingRowAction[];
  undo(): void;
} {
  const { hiddenIds, paidIds, pending, schedule, undo } = usePendingRowActions({
    onError: reportCommitError,
  });
  const resolve = useCallback(
    (id: string, kind: UpcomingActionKind) => {
      // A repeat on a row that already waits schedules nothing, so it buzzes nothing.
      if (!schedule(id, kind)) return;
      if (kind === "markPaid") hapticSuccess();
      else hapticSelection();
    },
    [schedule],
  );
  const actions = useMemo(
    () => ({ hiddenIds, paidIds, resolve }),
    [hiddenIds, paidIds, resolve],
  );
  return { actions, pending, undo };
}
