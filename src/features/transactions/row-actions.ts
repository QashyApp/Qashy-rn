import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import type { ExchangeRateService } from "@/data/exchange-rates/rate-service";
import type { FinanceRepository } from "@/data/repository";
import type { TransactionRecord } from "@/domain/models";
import { markUpcomingPaid, upcomingCurrencies } from "./mark-upcoming-paid";
import { useExchangeRateService } from "@/providers/exchange-rate-provider";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";

/**
 * Row actions on the transactions list (swipe or button) that cannot be taken back once the
 * repository has them: deleting erases to a tombstone, and an upcoming payment can neither be
 * un-skipped nor un-paid. Undo therefore works by deferring the commit. The row is hidden at once,
 * an Undo bar shows for `ROW_ACTION_UNDO_MS`, and the real repository call runs only when the bar
 * expires, another action is scheduled, the screen loses focus or unmounts, or the app leaves the
 * foreground. If the app is killed inside the window the action simply never happens.
 */

export type RowActionKind = "delete" | "skip" | "markPaid";

/** Marking paid keeps the same transaction (now posted), so its row is never hidden meanwhile. */
function hidesRow(kind: RowActionKind): boolean {
  return kind !== "markPaid";
}

/** How long the Undo bar stays up before the action is committed. */
export const ROW_ACTION_UNDO_MS = 5000;

/** English message key for the Undo bar; pass it through `t()`. */
export function rowActionMessage(kind: RowActionKind): string {
  switch (kind) {
    case "delete":
      return "Transaction deleted";
    case "skip":
      return "Payment skipped";
    case "markPaid":
      return "Marked as paid";
  }
}

/**
 * Performs the real repository mutation for one row, exactly as the per-row code does:
 * `delete` -> `deleteEntities("transactions", [id])`; `skip` -> `skipUpcoming(id)`;
 * `markPaid` -> `markUpcomingPaid` (fetches today's rates for the transaction's currencies, then
 * `confirmUpcoming`). Rejects when the repository does; the caller reports it.
 *
 * Haptics and error dialogs are the caller's concern (the existing buttons keep theirs), so a
 * deferred commit does not buzz seconds after the gesture.
 *
 * @param transaction Needed by `markPaid` only, for its currencies; omitted, none are pre-fetched.
 */
export async function commitRowAction(
  repository: FinanceRepository,
  rates: ExchangeRateService,
  kind: RowActionKind,
  id: string,
  transaction?: Pick<TransactionRecord, "currency" | "destinationCurrency">,
): Promise<void> {
  switch (kind) {
    case "delete":
      await repository.deleteEntities("transactions", [id]);
      return;
    case "skip":
      await repository.skipUpcoming(id);
      return;
    case "markPaid":
      await markUpcomingPaid(
        repository,
        rates,
        id,
        transaction ? upcomingCurrencies(transaction) : [],
      );
      return;
  }
}

export interface PendingRowAction {
  id: string;
  kind: RowActionKind;
}

export interface RowActionsState {
  /**
   * Rows to hide: the pending one (once its hide delay is over) plus any whose commit is still in
   * flight.
   */
  hiddenIds: ReadonlySet<string>;
  /**
   * Rows being marked paid (pending or committing). They stay in the list, drawn as paid, since
   * the transaction keeps its id and only changes status.
   */
  paidIds: ReadonlySet<string>;
  pending: PendingRowAction | null;
}

const EMPTY_STATE: RowActionsState = {
  hiddenIds: new Set(),
  paidIds: new Set(),
  pending: null,
};

export interface RowActionHandlers {
  commit: (id: string, kind: RowActionKind) => Promise<void>;
  onError: (kind: RowActionKind, error: unknown) => void;
}

export interface RowActionQueue {
  getState(): RowActionsState;
  /** Swaps the handlers, so a commit always uses those of the latest render. */
  configure(handlers: RowActionHandlers): void;
  subscribe(listener: () => void): () => void;
  /**
   * Makes `id` the pending action. `hideDelayMs` holds the row in the list that long (a swipe is
   * still sliding it away) before it is hidden; the Undo bar and the commit are not delayed.
   * Returns false when the row already has an action pending or committing (nothing is scheduled).
   * `markPaid` never hides its row: the same transaction stays in the list and re-renders as
   * posted.
   */
  schedule(id: string, kind: RowActionKind, hideDelayMs?: number): boolean;
  undo(): void;
  /** Commits the pending action now. Also what every flush trigger (blur, unmount, background) calls. */
  flush(): void;
  /** Drops the pending action, uncommitted, when its transaction is no longer in the data. */
  prune(existingIds: ReadonlySet<string>): void;
}

/**
 * The queue behind `usePendingRowActions`, free of React so its transitions are testable. At most
 * one action is pending; scheduling another commits it first. A commit starts only after the pending
 * slot is cleared, so an action can never commit twice, and a row stays hidden while its commit is
 * in flight. A failed commit unhides the row and reports through `onError`.
 */
export function createRowActionQueue(
  initial: RowActionHandlers,
): RowActionQueue {
  let handlers = initial;
  let pending: PendingRowAction | null = null;
  /** The pending row is hidden; false only during `schedule`'s hide delay. */
  let pendingHidden = true;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const inFlight = new Map<string, number>();
  /** In-flight ids whose row stays in the list (see `hidesRow`). */
  const inFlightVisible = new Set<string>();
  const listeners = new Set<() => void>();
  let state: RowActionsState = EMPTY_STATE;

  const publish = () => {
    const hidden = new Set(
      [...inFlight.keys()].filter((id) => !inFlightVisible.has(id)),
    );
    if (pending && pendingHidden && hidesRow(pending.kind))
      hidden.add(pending.id);
    const paid = new Set(inFlightVisible);
    if (pending && !hidesRow(pending.kind)) paid.add(pending.id);
    // Keep the previous object when nothing visible changed, so subscribers do not re-render.
    const same =
      state.pending?.id === pending?.id &&
      state.pending?.kind === pending?.kind &&
      state.hiddenIds.size === hidden.size &&
      [...hidden].every((id) => state.hiddenIds.has(id)) &&
      state.paidIds.size === paid.size &&
      [...paid].every((id) => state.paidIds.has(id));
    if (same) return;
    state =
      hidden.size === 0 && paid.size === 0 && !pending
        ? EMPTY_STATE
        : { hiddenIds: hidden, paidIds: paid, pending };
    for (const listener of [...listeners]) listener();
  };

  const run = (action: PendingRowAction) => {
    inFlight.set(action.id, (inFlight.get(action.id) ?? 0) + 1);
    if (!hidesRow(action.kind)) inFlightVisible.add(action.id);
    const settle = () => {
      const left = (inFlight.get(action.id) ?? 1) - 1;
      if (left > 0) inFlight.set(action.id, left);
      else {
        inFlight.delete(action.id);
        inFlightVisible.delete(action.id);
      }
    };
    let promise: Promise<void>;
    try {
      promise = handlers.commit(action.id, action.kind);
    } catch (reason) {
      promise = Promise.reject(reason);
    }
    promise.then(
      () => {
        settle();
        publish();
      },
      (reason: unknown) => {
        // Unhidden by the settle, then reported.
        settle();
        publish();
        handlers.onError(action.kind, reason);
      },
    );
  };

  const dropPending = () => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    pendingHidden = true;
    pending = null;
  };

  const flush = () => {
    if (!pending) return;
    const action = pending;
    dropPending();
    run(action);
    publish();
  };

  return {
    getState: () => state,
    configure(next) {
      handlers = next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    schedule(id, kind, hideDelayMs = 0) {
      // The row is already hidden (pending or committing), so there is nothing new to schedule.
      if (pending?.id === id || inFlight.has(id)) return false;
      if (pending) {
        const previous = pending;
        dropPending();
        run(previous);
      }
      pending = { id, kind };
      if (hideDelayMs > 0 && hidesRow(kind)) {
        pendingHidden = false;
        hideTimer = setTimeout(() => {
          hideTimer = undefined;
          if (pending?.id !== id) return;
          pendingHidden = true;
          publish();
        }, hideDelayMs);
      }
      publish();
      return true;
    },
    undo() {
      if (!pending) return;
      dropPending();
      publish();
    },
    flush,
    prune(existingIds) {
      if (pending && !existingIds.has(pending.id)) {
        dropPending();
        publish();
      }
    },
  };
}

/**
 * Deferred, undoable row actions for the transactions list. Reads the repository, rate service and
 * transactions from their providers. Flushes (commits) the pending action when the screen loses
 * focus or unmounts (sections stay mounted on web, so focus matters) and when the app leaves the
 * foreground. Run `expire()` from the Undo bar's dismissal.
 */
export function usePendingRowActions(options: {
  onError: (kind: RowActionKind, error: unknown) => void;
}): {
  hiddenIds: ReadonlySet<string>;
  paidIds: ReadonlySet<string>;
  pending: PendingRowAction | null;
  schedule(id: string, kind: RowActionKind, hideDelayMs?: number): boolean;
  undo(): void;
  expire(): void;
} {
  const repository = useFinanceRepository();
  const rates = useExchangeRateService();
  const { transactions } = useFinanceState();

  const [queue] = useState(() =>
    createRowActionQueue({
      commit: async () => undefined,
      onError: () => undefined,
    }),
  );
  // Handlers are swapped in after every render, so a commit made seconds later uses the latest
  // data and callbacks rather than those of the render that scheduled it.
  const { onError } = options;
  useEffect(() => {
    queue.configure({
      commit: (id, kind) =>
        commitRowAction(
          repository,
          rates,
          kind,
          id,
          transactions.find((item) => item.id === id),
        ),
      onError,
    });
  }, [queue, repository, rates, transactions, onError]);

  const state = useSyncExternalStore(
    queue.subscribe,
    queue.getState,
    queue.getState,
  );

  // A transaction that left the data under a pending action (a synced delete) takes it with it.
  useEffect(() => {
    queue.prune(new Set(transactions.map((item) => item.id)));
  }, [queue, transactions]);

  useEffect(() => () => queue.flush(), [queue]);
  useFocusEffect(useCallback(() => () => queue.flush(), [queue]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") queue.flush();
    });
    return () => subscription.remove();
  }, [queue]);

  return {
    hiddenIds: state.hiddenIds,
    paidIds: state.paidIds,
    pending: state.pending,
    schedule: queue.schedule,
    undo: queue.undo,
    expire: queue.flush,
  };
}
