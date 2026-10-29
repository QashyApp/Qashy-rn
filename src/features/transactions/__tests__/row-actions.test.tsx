import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

import {
  MAX_PENDING_ROW_ACTIONS,
  ROW_ACTION_UNDO_MS,
  commitRowAction,
  createRowActionQueue,
  rowActionMessage,
  rowActionsMessage,
  usePendingRowActions,
  type RowActionKind,
} from "@/features/transactions/row-actions";

const mockRepository = {
  deleteEntities: jest.fn(async (..._args: unknown[]) => undefined),
  skipUpcoming: jest.fn(async (..._args: unknown[]) => undefined),
  confirmUpcoming: jest.fn(async (..._args: unknown[]) => undefined),
};
const mockRates = {
  ensureRatesFor: jest.fn(async (..._args: unknown[]) => undefined),
};
let mockTransactions: { id: string; currency: string }[] = [];
const mockBlurCleanups: (() => void)[] = [];

jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => (() => void) | void) => {
    // Run on mount like the real one, and keep the cleanup so a test can "blur".
    const { useEffect } = jest.requireActual("react");
    useEffect(() => {
      const cleanup = effect();
      if (cleanup) mockBlurCleanups.push(cleanup);
    }, [effect]);
  },
}));
jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => mockRepository,
  useFinanceState: () => ({ transactions: mockTransactions }),
}));
jest.mock("@/providers/exchange-rate-provider", () => ({
  useExchangeRateService: () => mockRates,
}));

let appStateHandler: ((state: string) => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  appStateHandler = undefined;
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, listener) => {
      appStateHandler = listener as (state: string) => void;
      return { remove: jest.fn() };
    });
  mockBlurCleanups.length = 0;
  mockTransactions = [
    { id: "a", currency: "USD" },
    { id: "b", currency: "EUR" },
  ];
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const repo = mockRepository as never;
const rates = mockRates as never;

describe("rowActionMessage", () => {
  it("returns the English message keys", () => {
    expect(rowActionMessage("delete")).toBe("Transaction deleted");
    expect(rowActionMessage("skip")).toBe("Payment skipped");
    expect(rowActionMessage("markPaid")).toBe("Marked as paid");
  });
});

describe("rowActionsMessage", () => {
  it("uses the single-action message for one action", () => {
    expect(rowActionsMessage([{ kind: "delete" }])).toBe("Transaction deleted");
    expect(rowActionsMessage([{ kind: "skip" }])).toBe("Payment skipped");
  });

  it("counts several actions of one kind", () => {
    const two = (kind: RowActionKind) => [{ kind }, { kind }];
    expect(rowActionsMessage(two("delete"))).toBe("2 transactions deleted");
    expect(rowActionsMessage(two("skip"))).toBe("2 payments skipped");
    expect(rowActionsMessage(two("markPaid"))).toBe("2 marked as paid");
  });

  it("counts changes when the kinds differ", () => {
    expect(
      rowActionsMessage([
        { kind: "delete" },
        { kind: "skip" },
        { kind: "delete" },
      ]),
    ).toBe("3 changes to undo");
  });

  it("is empty with nothing pending", () => {
    expect(rowActionsMessage([])).toBe("");
  });
});

describe("the undo window", () => {
  it("is eight seconds", () => {
    expect(ROW_ACTION_UNDO_MS).toBe(8000);
  });
});

describe("commitRowAction", () => {
  it("deletes through deleteEntities", async () => {
    await commitRowAction(repo, rates, "delete", "a");
    expect(mockRepository.deleteEntities).toHaveBeenCalledWith("transactions", [
      "a",
    ]);
  });

  it("skips through skipUpcoming", async () => {
    await commitRowAction(repo, rates, "skip", "a");
    expect(mockRepository.skipUpcoming).toHaveBeenCalledWith("a");
  });

  it("marks paid after fetching the rates of the transaction's currencies", async () => {
    await commitRowAction(repo, rates, "markPaid", "a", {
      currency: "USD",
      destinationCurrency: "EUR",
    });
    const request = mockRates.ensureRatesFor.mock.calls[0]?.[0] as {
      currency: string;
    }[];
    expect(request.map((item) => item.currency)).toEqual(["USD", "EUR"]);
    expect(mockRepository.confirmUpcoming).toHaveBeenCalledWith("a");
  });

  it("retries rate pairs a recent failure negative-cached", async () => {
    await commitRowAction(repo, rates, "markPaid", "a", {
      currency: "USD",
      destinationCurrency: null,
    });
    expect(mockRates.ensureRatesFor.mock.calls[0]?.[1]).toEqual({
      retry: true,
    });
  });
});

describe("createRowActionQueue", () => {
  const setup = () => {
    const commit = jest.fn(
      async (_id: string, _kind: RowActionKind): Promise<void> => undefined,
    );
    const onError = jest.fn();
    return {
      commit,
      onError,
      queue: createRowActionQueue({ commit, onError }),
    };
  };

  it("schedule then undo never commits and unhides the row", () => {
    const { queue, commit } = setup();
    queue.schedule("a", "delete");
    expect(queue.getState().pending).toEqual([{ id: "a", kind: "delete" }]);
    expect(queue.getState().hiddenIds.has("a")).toBe(true);
    queue.undo();
    queue.flush();
    expect(commit).not.toHaveBeenCalled();
    expect(queue.getState().pending).toEqual([]);
    expect(queue.getState().hiddenIds.size).toBe(0);
  });

  describe("hide delay", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("shows the Undo bar at once but hides the row only after the delay", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete", 250);
      expect(queue.getState().pending).toEqual([{ id: "a", kind: "delete" }]);
      expect(queue.getState().hiddenIds.has("a")).toBe(false);
      jest.advanceTimersByTime(249);
      expect(queue.getState().hiddenIds.has("a")).toBe(false);
      jest.advanceTimersByTime(1);
      expect(queue.getState().hiddenIds.has("a")).toBe(true);
      expect(commit).not.toHaveBeenCalled();
    });

    it("undo before the row is hidden never hides it", () => {
      const { queue, commit } = setup();
      const listener = jest.fn();
      queue.subscribe(listener);
      queue.schedule("a", "skip", 250);
      queue.undo();
      jest.advanceTimersByTime(1000);
      expect(queue.getState().pending).toEqual([]);
      expect(queue.getState().hiddenIds.size).toBe(0);
      queue.flush();
      expect(commit).not.toHaveBeenCalled();
    });

    it("a flush during the delay still commits, and keeps the row hidden while it runs", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "skip", 250);
      queue.flush();
      expect(commit).toHaveBeenCalledWith("a", "skip");
      expect(queue.getState().hiddenIds.has("a")).toBe(true);
      jest.advanceTimersByTime(1000);
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it("marking paid never hides its row, delay or not", () => {
      const { queue } = setup();
      queue.schedule("a", "markPaid", 250);
      jest.advanceTimersByTime(1000);
      expect(queue.getState().pending).toEqual([{ id: "a", kind: "markPaid" }]);
      expect(queue.getState().hiddenIds.size).toBe(0);
    });

    it("scheduling another action during the delay leaves the first pending and hides both in turn", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete", 250);
      queue.schedule("b", "delete", 250);
      expect(commit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(250);
      expect(queue.getState().hiddenIds.has("a")).toBe(true);
      expect(queue.getState().hiddenIds.has("b")).toBe(true);
    });
  });

  describe("undo stack", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("a second action does not commit the first", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete");
      queue.schedule("b", "skip");
      expect(commit).not.toHaveBeenCalled();
      expect(queue.getState().pending).toEqual([
        { id: "a", kind: "delete" },
        { id: "b", kind: "skip" },
      ]);
      expect([...queue.getState().hiddenIds].sort()).toEqual(["a", "b"]);
    });

    it("commits each action when its own window ends, not the others", async () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete");
      jest.advanceTimersByTime(3000);
      queue.schedule("b", "delete");
      jest.advanceTimersByTime(ROW_ACTION_UNDO_MS - 3000);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith("a", "delete");
      expect(queue.getState().pending).toEqual([{ id: "b", kind: "delete" }]);
      // The first stays hidden while its commit runs.
      expect(queue.getState().hiddenIds.has("a")).toBe(true);
      jest.advanceTimersByTime(3000);
      expect(commit).toHaveBeenCalledTimes(2);
      expect(commit).toHaveBeenLastCalledWith("b", "delete");
      expect(queue.getState().pending).toEqual([]);
    });

    it("undo restores every pending action and nothing commits later", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete");
      queue.schedule("b", "skip");
      queue.schedule("c", "markPaid");
      queue.undo();
      jest.advanceTimersByTime(ROW_ACTION_UNDO_MS * 2);
      expect(commit).not.toHaveBeenCalled();
      expect(queue.getState().pending).toEqual([]);
      expect(queue.getState().hiddenIds.size).toBe(0);
      expect(queue.getState().paidIds.size).toBe(0);
    });

    it("undo after the first has committed restores only what still waits", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete");
      jest.advanceTimersByTime(ROW_ACTION_UNDO_MS);
      queue.schedule("b", "delete");
      queue.undo();
      jest.advanceTimersByTime(ROW_ACTION_UNDO_MS);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith("a", "delete");
    });

    it("flush commits all of them, once each, and clears their timers", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete");
      queue.schedule("b", "skip");
      queue.flush();
      expect(commit).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(ROW_ACTION_UNDO_MS * 2);
      expect(commit).toHaveBeenCalledTimes(2);
    });

    it("keeps at most five pending, committing the oldest to make room", () => {
      const { queue, commit } = setup();
      const ids = ["a", "b", "c", "d", "e", "f"];
      expect(MAX_PENDING_ROW_ACTIONS).toBe(5);
      for (const id of ids) queue.schedule(id, "delete");
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith("a", "delete");
      expect(queue.getState().pending.map((item) => item.id)).toEqual([
        "b",
        "c",
        "d",
        "e",
        "f",
      ]);
      // An evicted action's timer must not commit it a second time.
      jest.advanceTimersByTime(ROW_ACTION_UNDO_MS);
      expect(commit).toHaveBeenCalledTimes(6);
      expect(commit.mock.calls.filter(([id]) => id === "a")).toHaveLength(1);
    });

    it("prunes only the pending actions whose transactions are gone", () => {
      const { queue, commit } = setup();
      queue.schedule("a", "delete");
      queue.schedule("b", "delete");
      queue.prune(new Set(["b"]));
      expect(queue.getState().pending).toEqual([{ id: "b", kind: "delete" }]);
      jest.advanceTimersByTime(ROW_ACTION_UNDO_MS);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith("b", "delete");
    });

    it("lists several rows being marked paid together", () => {
      const { queue } = setup();
      queue.schedule("a", "markPaid");
      queue.schedule("b", "markPaid");
      expect([...queue.getState().paidIds].sort()).toEqual(["a", "b"]);
      queue.undo();
      expect(queue.getState().paidIds.size).toBe(0);
    });
  });

  it("schedule then flush commits once, however often it is flushed", async () => {
    const { queue, commit } = setup();
    queue.schedule("a", "skip");
    queue.flush();
    queue.flush();
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("a", "skip");
    expect(queue.getState().hiddenIds.size).toBe(0);
  });

  it("keeps a row being marked paid in the list while pending and while committing", async () => {
    const { queue, commit } = setup();
    const gate = deferred();
    commit.mockReturnValueOnce(gate.promise);
    expect(queue.schedule("a", "markPaid")).toBe(true);
    expect(queue.getState().pending).toEqual([{ id: "a", kind: "markPaid" }]);
    expect(queue.getState().hiddenIds.size).toBe(0);
    queue.flush();
    expect(commit).toHaveBeenCalledWith("a", "markPaid");
    expect(queue.getState().hiddenIds.size).toBe(0);
    // A repeat while it commits schedules nothing.
    expect(queue.schedule("a", "markPaid")).toBe(false);
    gate.resolve();
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(queue.getState().hiddenIds.size).toBe(0);
  });

  it("lists a row being marked paid as paid while pending and committing, and not after an undo", async () => {
    const { queue, commit } = setup();
    const gate = deferred();
    commit.mockReturnValueOnce(gate.promise);
    queue.schedule("a", "markPaid");
    expect([...queue.getState().paidIds]).toEqual(["a"]);
    queue.undo();
    expect(queue.getState().paidIds.size).toBe(0);
    queue.schedule("a", "markPaid");
    queue.flush();
    expect([...queue.getState().paidIds]).toEqual(["a"]);
    gate.resolve();
    await flushPromises();
    expect(queue.getState().paidIds.size).toBe(0);
  });

  it("does not list deleted or skipped rows as paid", () => {
    const { queue } = setup();
    queue.schedule("a", "skip");
    expect(queue.getState().paidIds.size).toBe(0);
  });

  it("refuses a second action on a row already marked paid", () => {
    const { queue } = setup();
    expect(queue.schedule("a", "markPaid")).toBe(true);
    expect(queue.schedule("a", "skip")).toBe(false);
    expect(queue.getState().pending).toEqual([{ id: "a", kind: "markPaid" }]);
  });

  it("reports whether a schedule was accepted", () => {
    const { queue } = setup();
    expect(queue.schedule("a", "delete")).toBe(true);
    expect(queue.schedule("a", "delete")).toBe(false);
  });

  it("ignores a second schedule of the same id, pending or in flight", async () => {
    const { queue, commit } = setup();
    const gate = deferred();
    commit.mockReturnValueOnce(gate.promise);
    queue.schedule("a", "delete");
    queue.schedule("a", "delete");
    queue.flush();
    queue.schedule("a", "delete");
    expect(queue.getState().pending).toEqual([]);
    gate.resolve();
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("a failed commit unhides the row and reports", async () => {
    const { queue, commit, onError } = setup();
    const failure = new Error("nope");
    commit.mockRejectedValueOnce(failure);
    queue.schedule("a", "delete");
    queue.flush();
    expect(queue.getState().hiddenIds.has("a")).toBe(true);
    await flushPromises();
    expect(queue.getState().hiddenIds.size).toBe(0);
    expect(onError).toHaveBeenCalledWith("delete", failure);
  });

  it("a synchronous throw from commit is handled like a rejection", async () => {
    const { queue, commit, onError } = setup();
    commit.mockImplementationOnce(() => {
      throw new Error("sync");
    });
    queue.schedule("a", "skip");
    queue.flush();
    await flushPromises();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(queue.getState().hiddenIds.size).toBe(0);
  });

  it("drops a pending action whose transaction left the data, without committing", () => {
    const { queue, commit } = setup();
    queue.schedule("a", "delete");
    queue.prune(new Set(["b"]));
    expect(queue.getState().pending).toEqual([]);
    expect(queue.getState().hiddenIds.size).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    queue.schedule("b", "delete");
    queue.prune(new Set(["b"]));
    expect(queue.getState().pending).toEqual([{ id: "b", kind: "delete" }]);
  });

  it("notifies subscribers only when something visible changed", () => {
    const { queue } = setup();
    const listener = jest.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.undo();
    queue.flush();
    expect(listener).not.toHaveBeenCalled();
    queue.schedule("a", "delete");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    queue.undo();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("usePendingRowActions", () => {
  const render = (onError: jest.Mock = jest.fn()) =>
    renderHook(() => usePendingRowActions({ onError }));

  it("expire commits the pending action through the repository", async () => {
    const { result } = await render();
    await act(async () => {
      result.current.schedule("a", "delete");
    });
    expect(result.current.hiddenIds.has("a")).toBe(true);
    expect(mockRepository.deleteEntities).not.toHaveBeenCalled();
    await act(async () => {
      result.current.expire();
    });
    await act(flushPromises);
    expect(mockRepository.deleteEntities).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toEqual([]);
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("undo cancels", async () => {
    const { result, unmount } = await render();
    await act(async () => {
      result.current.schedule("a", "skip");
    });
    await act(async () => {
      result.current.undo();
    });
    await unmount();
    await flushPromises();
    expect(mockRepository.skipUpcoming).not.toHaveBeenCalled();
  });

  it("commits when the screen unmounts", async () => {
    const { result, unmount } = await render();
    await act(async () => {
      result.current.schedule("a", "delete");
    });
    await unmount();
    await flushPromises();
    expect(mockRepository.deleteEntities).toHaveBeenCalledTimes(1);
  });

  it("commits when the screen loses focus", async () => {
    const { result } = await render();
    await act(async () => {
      result.current.schedule("a", "delete");
    });
    await act(async () => {
      mockBlurCleanups.forEach((cleanup) => cleanup());
    });
    await act(flushPromises);
    expect(mockRepository.deleteEntities).toHaveBeenCalledTimes(1);
  });

  it("commits when the app leaves the foreground, not when it returns", async () => {
    const { result } = await render();
    await act(async () => {
      result.current.schedule("a", "skip");
    });
    await act(async () => {
      appStateHandler?.("active");
    });
    expect(mockRepository.skipUpcoming).not.toHaveBeenCalled();
    await act(async () => {
      appStateHandler?.("background");
    });
    await act(flushPromises);
    expect(mockRepository.skipUpcoming).toHaveBeenCalledTimes(1);
  });

  it("reports a failed commit and unhides the row", async () => {
    const onError = jest.fn();
    const failure = new Error("nope");
    mockRepository.deleteEntities.mockRejectedValueOnce(failure);
    const { result } = await render(onError);
    await act(async () => {
      result.current.schedule("a", "delete");
    });
    await act(async () => {
      result.current.expire();
    });
    await act(flushPromises);
    expect(onError).toHaveBeenCalledWith("delete", failure);
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("drops a pending action when its transaction disappears from the data", async () => {
    const { result, rerender } = await render();
    await act(async () => {
      result.current.schedule("a", "delete");
    });
    mockTransactions = [{ id: "b", currency: "EUR" }];
    await rerender({});
    expect(result.current.pending).toEqual([]);
    await act(async () => {
      result.current.expire();
    });
    await act(flushPromises);
    expect(mockRepository.deleteEntities).not.toHaveBeenCalled();
  });

  it("passes the transaction's currencies to a mark-paid commit", async () => {
    const { result } = await render();
    await act(async () => {
      result.current.schedule("b", "markPaid");
    });
    await act(async () => {
      result.current.expire();
    });
    await act(flushPromises);
    expect(mockRates.ensureRatesFor).toHaveBeenCalledWith(
      [expect.objectContaining({ currency: "EUR" })],
      { retry: true },
    );
    expect(mockRepository.confirmUpcoming).toHaveBeenCalledWith("b");
  });
});
