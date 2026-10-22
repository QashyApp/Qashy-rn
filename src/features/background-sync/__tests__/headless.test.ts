/**
 * The "QashyBackgroundSync" task, end to end over fakes: the real wiring in `run.ts` and the
 * real task body, with the repository, runtime, keystore and native module replaced.
 */

import { AppRegistry } from "react-native";

import { MemoryStorageAdapter } from "@/data/memory-storage";
import { runBackgroundSyncOnce } from "@/features/background-sync/run";
import { runBackgroundSyncTask } from "@/sync/background";
import { SYNC_META, writeMeta } from "@/data/sync-store";

const mockStorage = new MemoryStorageAdapter();
const mockSetDeviceId = jest.fn();
const mockRepository = {
  initialize: jest.fn(async (_options?: { generateRecurring?: boolean }) => {}),
  generateRecurring: jest.fn(async () => {}),
  applyRemoteOps: jest.fn(),
  repairProjection: jest.fn(),
};
const mockReconcile = jest.fn(async (_signal?: AbortSignal) => ({
  reason: "ok",
  outcome: null,
  health: {},
}));
const mockClose = jest.fn(async () => {});
const mockRefreshWidgets = jest.fn(async () => true);
const mockReport = jest.fn();
const mockSetBackgroundSync = jest.fn(async (_enabled: boolean) => {});
const mockKeystoreRead = jest.fn();
let mockSetting = true;

jest.mock("@/data/local-finance-repository", () => ({
  get financeRepository() {
    return mockRepository;
  },
  get syncingStorage() {
    return Object.assign(mockStorage, { setDeviceId: mockSetDeviceId });
  },
}));
jest.mock("@/data/device-local/background-sync-store", () => ({
  readBackgroundSync: async () => mockSetting,
}));
jest.mock("@/sync/keystore/platform", () => ({
  createPlatformKeystore: () => ({ read: mockKeystoreRead }),
}));
jest.mock("@/sync/runtime", () => ({
  SyncRuntime: class {
    reconcile = mockReconcile;
    close = mockClose;
  },
}));
jest.mock("@/features/widgets/refresher", () => ({
  refreshWidgets: () => mockRefreshWidgets(),
}));
jest.mock("../../../../modules/qashy-widgets", () => ({
  reportHeadlessResult: (ok: boolean) => mockReport(ok),
  setBackgroundSync: (enabled: boolean) => mockSetBackgroundSync(enabled),
}));

let task: () => Promise<void>;

beforeAll(async () => {
  // The same composition the registered task runs: the real body over the real wiring.
  task = () =>
    runBackgroundSyncTask({
      run: runBackgroundSyncOnce,
      report: mockReport,
      warn: (message) => console.warn(message),
    });
  await mockStorage.initialize();
});

it("registers the headless task under the name the native worker starts", () => {
  const register = jest
    .spyOn(AppRegistry, "registerHeadlessTask")
    .mockImplementation(() => {});
  // A plain require: the module registers on load, after the spy above is in place.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@/features/background-sync/headless.native");
  expect(register.mock.calls.map(([name]) => name)).toEqual([
    "QashyBackgroundSync",
  ]);
  register.mockRestore();
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockSetting = true;
  mockKeystoreRead.mockResolvedValue({ identity: { deviceId: "device-1" } });
  await mockStorage.transact((tx) =>
    writeMeta(tx, { [SYNC_META.enabled]: "1" }),
  );
});

describe("QashyBackgroundSync headless task", () => {
  it("is a no-op that cancels the schedule when the setting is off", async () => {
    mockSetting = false;
    await task();
    expect(mockRepository.initialize).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockRefreshWidgets).not.toHaveBeenCalled();
    expect(mockSetBackgroundSync).toHaveBeenCalledWith(false);
    expect(mockReport).toHaveBeenCalledWith(true);
  });

  it("runs one reconcile then refreshes widgets, without generating recurring transactions", async () => {
    await task();
    expect(mockRepository.initialize.mock.calls).toEqual([
      [{ generateRecurring: false }],
    ]);
    expect(mockRepository.generateRecurring).not.toHaveBeenCalled();
    expect(mockSetDeviceId).toHaveBeenCalledWith("device-1");
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockRefreshWidgets).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls).toEqual([[true]]);
  });

  it("cancels the schedule and syncs nothing when sync is off", async () => {
    await mockStorage.transact((tx) =>
      writeMeta(tx, { [SYNC_META.enabled]: "0" }),
    );
    await task();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockSetBackgroundSync).toHaveBeenCalledWith(false);
  });

  it("skips a keystore that will not answer, and does not cancel the opt-in", async () => {
    const { KeystoreError } = jest.requireActual("@/sync/keystore") as {
      KeystoreError: new (code: string, message: string) => Error;
    };
    mockKeystoreRead.mockRejectedValue(new KeystoreError("locked", "locked"));
    await task();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockSetBackgroundSync).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenCalledWith(true);
  });

  it("resolves, reports failure and skips the widget refresh when the pass rejects", async () => {
    mockReconcile.mockRejectedValueOnce(
      Object.assign(new Error("chain break"), { name: "ChainBreak" }),
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(task()).resolves.toBeUndefined();
    expect(mockRefreshWidgets).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls).toEqual([[false]]);
    expect(warn).toHaveBeenCalledWith(
      "[sync] Background sync failed (ChainBreak)",
    );
    warn.mockRestore();
  });
});
