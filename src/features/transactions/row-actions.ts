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
 * un-skipped nor un-paid. Undo therefore works by deferring the commit. The row is hidden at once
 * and the real repository call runs only when that action's own `ROW_ACTION_UNDO_MS` window ends,
 * the screen loses focus or unmounts, or the app leaves the foreground. If the app is killed
 * inside the window the action simply never happens.
 *
 * Up to `MAX_PENDING_ROW_ACTIONS` actions wait at once, each with its own timer, so a second swipe
 * never makes the first one permanent. One Undo bar speaks for all of them ("3 transactions
 * deleted") and Undo restores every action still waiting.
 */

export type RowActionKind = "delete" | "skip" | "markPaid";

/** Marking paid keeps the same transaction (now posted), so its row is never hidden meanwhile. */
function hidesRow(kind: RowActionKind): boolean {
  return kind !== "markPaid";
}

/** How long an action waits for Undo before it is committed. */
export const ROW_ACTION_UNDO_MS = 8000;

/** The most actions that wait on Undo together; scheduling one more commits the oldest. */
export const MAX_PENDING_ROW_ACTIONS = 5;

/** English message key for the Undo bar when one action waits; pass it through `t()`. */
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
 * English message key for the Undo bar over every action that waits: the single-action message for
 * one, a count of the shared kind for several, and a count of changes when the kinds differ. Pass
 * it through `t()`.
 */
export function rowActionsMessage(
  pending: readonly Pick<PendingRowAction, "kind">[],
): string {
  const count = pending.length;
  if (count === 0) return "";
  const first = pending[0].kind;
  if (count === 1) return rowActionMessage(first);
  if (pending.some((item) => item.kind !== first))
    return `${count} changes to undo`;
  switch (first) {
    case "delete":
      return `${count} transactions deleted`;
    case "skip":
      return `${count} payments skipped`;
    case "markPaid":
      return `${count} marked as paid`;
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
   * Rows to hide: each pending one (once its hide delay is over) plus any whose commit is still in
   * flight.
   */
  hiddenIds: ReadonlySet<string>;
  /**
   * Rows being marked paid (pending or committing). They stay in the list, drawn as paid, since
   * the transaction keeps its id and only changes status.
   */
  paidIds: ReadonlySet<string>;
  /** The actions waiting on Undo, oldest first. */
  pending: readonly PendingRowAction[];
}

const EMPTY_STATE: RowActionsState = {
  hiddenIds: new Set(),
  paidIds: new Set(),
  pending: [],
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
   * Adds `id` to the pending actions, to be committed after its own undo window. `hideDelayMs`
   * holds the row in the list that long (a swipe is still sliding it away) before it is hidden;
   * the Undo bar and the commit are not delayed. Returns false when the row already has an action
   * pending or committing (nothing is scheduled). When `MAX_PENDING_ROW_ACTIONS` already wait, the
   * oldest is committed to make room. `markPaid` never hides its row: the same transaction stays
   * in the list and re-renders as posted.
   */
  schedule(id: string, kind: RowActionKind, hideDelayMs?: number): boolean;
  /** Cancels every pending action, uncommitted, and brings their rows back. */
  undo(): void;
  /** Commits every pending action now. Also what every flush trigger (blur, unmount, background) calls. */
  flush(): void;
  /** Drops pending actions, uncommitted, whose transactions are no longer in the data. */
  prune(existingIds: ReadonlySet<string>): void;
}

interface PendingEntry {
  action: PendingRowAction;
  /** The row is hidden; false only during `schedule`'s hide delay. */
  hidden: boolean;
  hideTimer: ReturnType<typeof setTimeout> | undefined;
  expireTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * The queue behind `usePendingRowActions`, free of React so its transitions are testable. Each
 * pending action has its own undo timer and commits on its own; scheduling another never commits
 * the ones already waiting (until `MAX_PENDING_ROW_ACTIONS` is reached). A commit starts only after
 * its entry has left the pending list, so an action can never commit twice, and a row stays hidden
 * while its commit is in flight. A failed commit unhides the row and reports through `onError`.
 */
export function createRowActionQueue(
  initial: RowActionHandlers,
  options: { undoMs?: number } = {},
): RowActionQueue {
  const undoMs = options.undoMs ?? ROW_ACTION_UNDO_MS;
  let handlers = initial;
  let entries: PendingEntry[] = [];
  const inFlight = new Map<string, number>();
  /** In-flight ids whose row stays in the list (see `hidesRow`). */
  const inFlightVisible = new Set<string>();
  const listeners = new Set<() => void>();
  let state: RowActionsState = EMPTY_STATE;

  const publish = () => {
    const hidden = new Set(
      [...inFlight.keys()].filter((id) => !inFlightVisible.has(id)),
    );
    const paid = new Set(inFlightVisible);
    for (const entry of entries) {
      if (!hidesRow(entry.action.kind)) paid.add(entry.action.id);
      else if (entry.hidden) hidden.add(entry.action.id);
    }
    // Keep the previous object when nothing visible changed, so subscribers do not re-render.
    const same =
      state.pending.length === entries.length &&
      entries.every(
        (entry, index) =>
          state.pending[index].id === entry.action.id &&
          state.pending[index].kind === entry.action.kind,
      ) &&
      state.hiddenIds.size === hidden.size &&
      [...hidden].every((id) => state.hiddenIds.has(id)) &&
      state.paidIds.size === paid.size &&
      [...paid].every((id) => state.paidIds.has(id));
    if (same) return;
    state =
      hidden.size === 0 && paid.size === 0 && entries.length === 0
        ? EMPTY_STATE
        : {
            hiddenIds: hidden,
            paidIds: paid,
            pending: entries.map((entry) => entry.action),
          };
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

  /** Takes `entry` off the pending list and stops its timers. */
  const drop = (entry: PendingEntry) => {
    clearTimeout(entry.hideTimer);
    clearTimeout(entry.expireTimer);
    entry.hideTimer = undefined;
    entry.expireTimer = undefined;
    entries = entries.filter((item) => item !== entry);
  };

  /** Commits one pending entry now. Does not publish. */
  const commitEntry = (entry: PendingEntry) => {
    drop(entry);
    run(entry.action);
  };

  const flush = () => {
    if (entries.length === 0) return;
    for (const entry of [...entries]) commitEntry(entry);
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
      if (entries.some((entry) => entry.action.id === id) || inFlight.has(id))
        return false;
      // A full stack makes room by committing its oldest action, never the newest.
      while (entries.length >= MAX_PENDING_ROW_ACTIONS) commitEntry(entries[0]);
      const entry: PendingEntry = {
        action: { id, kind },
        hidden: true,
        hideTimer: undefined,
        expireTimer: undefined,
      };
      entries = [...entries, entry];
      entry.expireTimer = setTimeout(() => {
        entry.expireTimer = undefined;
        if (!entries.includes(entry)) return;
        commitEntry(entry);
        publish();
      }, undoMs);
      if (hideDelayMs > 0 && hidesRow(kind)) {
        entry.hidden = false;
        entry.hideTimer = setTimeout(() => {
          entry.hideTimer = undefined;
          if (!entries.includes(entry)) return;
          entry.hidden = true;
          publish();
        }, hideDelayMs);
      }
      publish();
      return true;
    },
    undo() {
      if (entries.length === 0) return;
      for (const entry of [...entries]) drop(entry);
      publish();
    },
    flush,
    prune(existingIds) {
      const gone = entries.filter((entry) => !existingIds.has(entry.action.id));
      if (gone.length === 0) return;
      for (const entry of gone) drop(entry);
      publish();
    },
  };
}

/**
 * Deferred, undoable row actions for the transactions list. Reads the repository, rate service and
 * transactions from their providers. Each action commits when its own undo window ends; all of
 * them are flushed (committed) when the screen loses focus or unmounts (sections stay mounted on
 * web, so focus matters) and when the app leaves the foreground. `expire()` commits them now.
 */
export function usePendingRowActions(options: {
  onError: (kind: RowActionKind, error: unknown) => void;
}): {
  hiddenIds: ReadonlySet<string>;
  paidIds: ReadonlySet<string>;
  pending: readonly PendingRowAction[];
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
