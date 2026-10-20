import {
  runBackgroundSync,
  runBackgroundSyncTask,
  type BackgroundSyncDeps,
  type BackgroundSyncStatus,
} from "@/sync/background";
import { withSyncPassLock } from "@/sync/pass-lock";
import type { SyncPass } from "@/sync/runtime";

const OK_PASS = {
  reason: "ok",
  outcome: null,
  health: {},
} as unknown as SyncPass;

function setup(overrides: Partial<BackgroundSyncDeps> = {}) {
  const order: string[] = [];
  const status: BackgroundSyncStatus = {
    enabled: true,
    keystore: "unlocked",
    deviceId: "device-1",
  };
  const deps = {
    isForeground: jest.fn(() => false),
    openStorage: jest.fn(async () => void order.push("openStorage")),
    readSetting: jest.fn(async () => {
      order.push("readSetting");
      return true;
    }),
    initializeRepository: jest.fn(
      async () => void order.push("initializeRepository"),
    ),
    readStatus: jest.fn(async () => {
      order.push("readStatus");
      return status;
    }),
    arm: jest.fn((id: string | null) => void order.push(`arm:${id}`)),
    reconcile: jest.fn(async (_signal: AbortSignal) => {
      order.push("reconcile");
      return OK_PASS;
    }),
    refreshWidgets: jest.fn(async () => {
      order.push("refreshWidgets");
      return true;
    }),
    cancelSchedule: jest.fn(async () => void order.push("cancelSchedule")),
    withLock: jest.fn(<T>(work: () => Promise<T>) => {
      order.push("lock");
      return work();
    }),
    timeoutMs: 1000,
    ...overrides,
  } satisfies BackgroundSyncDeps;
  return { deps, order, run: () => runBackgroundSync(deps) };
}

describe("runBackgroundSync", () => {
  it("does nothing and cancels the schedule when the setting is off", async () => {
    const { deps, order, run } = setup({ readSetting: async () => false });
    await expect(run()).resolves.toBe("disabled");
    expect(deps.cancelSchedule).toHaveBeenCalledTimes(1);
    expect(deps.initializeRepository).not.toHaveBeenCalled();
    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(deps.refreshWidgets).not.toHaveBeenCalled();
    expect(order).toEqual(["openStorage", "cancelSchedule"]);
  });

  it("skips entirely while the app is in the foreground", async () => {
    const { deps, run } = setup({ isForeground: () => true });
    await expect(run()).resolves.toBe("foreground");
    expect(deps.openStorage).not.toHaveBeenCalled();
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it("re-checks the foreground inside the lock", async () => {
    let calls = 0;
    const { deps, run } = setup({ isForeground: () => ++calls > 1 });
    await expect(run()).resolves.toBe("foreground");
    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(deps.readStatus).not.toHaveBeenCalled();
  });

  it("runs exactly one reconcile, then refreshes widgets, in order", async () => {
    const { deps, order, run } = setup();
    await expect(run()).resolves.toBe("synced");
    expect(deps.reconcile).toHaveBeenCalledTimes(1);
    expect(deps.refreshWidgets).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "openStorage",
      "readSetting",
      "initializeRepository",
      "lock",
      "readStatus",
      "arm:device-1",
      "reconcile",
      "refreshWidgets",
    ]);
  });

  it("cancels the schedule and does not sync when sync is switched off", async () => {
    const { deps, run } = setup({
      readStatus: async () => ({
        enabled: false,
        keystore: "empty",
        deviceId: "",
      }),
    });
    await expect(run()).resolves.toBe("disabled");
    expect(deps.cancelSchedule).toHaveBeenCalledTimes(1);
    expect(deps.arm).toHaveBeenCalledWith(null);
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it.each(["locked", "unavailable", "empty"])(
    "skips gracefully, without cancelling, when the keystore is %s",
    async (keystore) => {
      const { deps, run } = setup({
        readStatus: async () => ({ enabled: true, keystore, deviceId: "" }),
      });
      await expect(run()).resolves.toBe("skipped");
      expect(deps.cancelSchedule).not.toHaveBeenCalled();
      expect(deps.reconcile).not.toHaveBeenCalled();
      expect(deps.refreshWidgets).not.toHaveBeenCalled();
    },
  );

  it("does not refresh widgets when the pass did not run", async () => {
    const { deps, run } = setup({
      reconcile: async () => ({ ...OK_PASS, reason: "locked" }) as SyncPass,
    });
    await expect(run()).resolves.toBe("skipped");
    expect(deps.refreshWidgets).not.toHaveBeenCalled();
  });

  it("lets a rejected pass propagate: no widget refresh, nothing swallowed", async () => {
    const failure = Object.assign(new Error("bad signature"), {
      name: "SignatureError",
    });
    const { deps, run } = setup({
      reconcile: async () => {
        throw failure;
      },
    });
    await expect(run()).rejects.toBe(failure);
    expect(deps.refreshWidgets).not.toHaveBeenCalled();
  });

  it("aborts the pass when its time budget runs out", async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      const { run } = setup({
        timeoutMs: 500,
        reconcile: (signal) =>
          new Promise<SyncPass>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve(OK_PASS);
            });
          }),
      });
      const pending = run();
      await jest.advanceTimersByTimeAsync(600);
      await pending;
      expect(aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("withSyncPassLock", () => {
  it("runs passes one at a time, in order, and survives a failing pass", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = withSyncPassLock(async () => {
      events.push("first:start");
      await gate;
      events.push("first:end");
    });
    const second = withSyncPassLock(async () => {
      events.push("second");
      throw new Error("boom");
    });
    const third = withSyncPassLock(async () => void events.push("third"));
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    release();
    await first;
    await expect(second).rejects.toThrow("boom");
    await third;
    expect(events).toEqual(["first:start", "first:end", "second", "third"]);
  });
});

describe("runBackgroundSyncTask", () => {
  it("reports success after a completed run", async () => {
    const report = jest.fn();
    await runBackgroundSyncTask({
      run: async () => "synced",
      report,
      warn: jest.fn(),
    });
    expect(report).toHaveBeenCalledWith(true);
  });

  it("reports failure, warns with only an error name, and resolves when the run throws", async () => {
    const report = jest.fn();
    const warn = jest.fn();
    await expect(
      runBackgroundSyncTask({
        run: async () => {
          throw Object.assign(new Error("Coffee $4.50 key=abc"), {
            name: "EpochMismatch",
          });
        },
        report,
        warn,
      }),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(false);
    expect(warn).toHaveBeenCalledWith(
      "[sync] Background sync failed (EpochMismatch)",
    );
  });

  it("still resolves when the report itself throws", async () => {
    await expect(
      runBackgroundSyncTask({
        run: async () => undefined,
        report: () => {
          throw new Error("no module");
        },
        warn: jest.fn(),
      }),
    ).resolves.toBeUndefined();
  });
});
