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
  /** Rows to hide: the pending one plus any whose commit is still in flight. */
  hiddenIds: ReadonlySet<string>;
  pending: PendingRowAction | null;
}

const EMPTY_STATE: RowActionsState = { hiddenIds: new Set(), pending: null };

export interface RowActionHandlers {
  commit: (id: string, kind: RowActionKind) => Promise<void>;
  onError: (kind: RowActionKind, error: unknown) => void;
}

export interface RowActionQueue {
  getState(): RowActionsState;
  /** Swaps the handlers, so a commit always uses those of the latest render. */
  configure(handlers: RowActionHandlers): void;
  subscribe(listener: () => void): () => void;
  schedule(id: string, kind: RowActionKind): void;
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
  const inFlight = new Map<string, number>();
  const listeners = new Set<() => void>();
  let state: RowActionsState = EMPTY_STATE;

  const publish = () => {
    const hidden = new Set(inFlight.keys());
    if (pending) hidden.add(pending.id);
    // Keep the previous object when nothing visible changed, so subscribers do not re-render.
    const same =
      state.pending?.id === pending?.id &&
      state.pending?.kind === pending?.kind &&
      state.hiddenIds.size === hidden.size &&
      [...hidden].every((id) => state.hiddenIds.has(id));
    if (same) return;
    state =
      hidden.size === 0 && !pending
        ? EMPTY_STATE
        : { hiddenIds: hidden, pending };
    for (const listener of [...listeners]) listener();
  };

  const run = (action: PendingRowAction) => {
    inFlight.set(action.id, (inFlight.get(action.id) ?? 0) + 1);
    const settle = () => {
      const left = (inFlight.get(action.id) ?? 1) - 1;
      if (left > 0) inFlight.set(action.id, left);
      else inFlight.delete(action.id);
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

  const flush = () => {
    if (!pending) return;
    const action = pending;
    pending = null;
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
    schedule(id, kind) {
      // The row is already hidden (pending or committing), so there is nothing new to schedule.
      if (pending?.id === id || inFlight.has(id)) return;
      if (pending) {
        const previous = pending;
        pending = null;
        run(previous);
      }
      pending = { id, kind };
      publish();
    },
    undo() {
      if (!pending) return;
      pending = null;
      publish();
    },
    flush,
    prune(existingIds) {
      if (pending && !existingIds.has(pending.id)) {
        pending = null;
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
  pending: PendingRowAction | null;
  schedule(id: string, kind: RowActionKind): void;
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
    pending: state.pending,
    schedule: queue.schedule,
    undo: queue.undo,
    expire: queue.flush,
  };
}
