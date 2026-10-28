import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

import {
  commitRowAction,
  createRowActionQueue,
  rowActionMessage,
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
    expect(queue.getState().pending).toEqual({ id: "a", kind: "delete" });
    expect(queue.getState().hiddenIds.has("a")).toBe(true);
    queue.undo();
    queue.flush();
    expect(commit).not.toHaveBeenCalled();
    expect(queue.getState().pending).toBeNull();
    expect(queue.getState().hiddenIds.size).toBe(0);
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

  it("scheduling B commits A and leaves B pending", () => {
    const { queue, commit } = setup();
    queue.schedule("a", "delete");
    queue.schedule("b", "markPaid");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("a", "delete");
    expect(queue.getState().pending).toEqual({ id: "b", kind: "markPaid" });
    expect([...queue.getState().hiddenIds].sort()).toEqual(["a", "b"]);
  });

  it("ignores a second schedule of the same id, pending or in flight", async () => {
    const { queue, commit } = setup();
    const gate = deferred();
    commit.mockReturnValueOnce(gate.promise);
    queue.schedule("a", "delete");
    queue.schedule("a", "delete");
    queue.flush();
    queue.schedule("a", "delete");
    expect(queue.getState().pending).toBeNull();
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
    expect(queue.getState().pending).toBeNull();
    expect(queue.getState().hiddenIds.size).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    queue.schedule("b", "delete");
    queue.prune(new Set(["b"]));
    expect(queue.getState().pending).toEqual({ id: "b", kind: "delete" });
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
    expect(result.current.pending).toBeNull();
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
    expect(result.current.pending).toBeNull();
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
    expect(mockRates.ensureRatesFor).toHaveBeenCalledWith([
      expect.objectContaining({ currency: "EUR" }),
    ]);
    expect(mockRepository.confirmUpcoming).toHaveBeenCalledWith("b");
  });
});
