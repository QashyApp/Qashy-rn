import {
  reconcileBackgroundSchedule,
  shouldScheduleBackgroundSync,
  type ScheduleDeps,
} from "@/features/background-sync/schedule";

const paired = { enabled: true, deviceId: "device-1" };

function setup(overrides: Partial<ScheduleDeps> = {}) {
  const deps = {
    isAvailable: jest.fn(() => true),
    setNative: jest.fn(async (_enabled: boolean) => undefined),
    readSetting: jest.fn(async () => true),
    ...overrides,
  } satisfies ScheduleDeps;
  return deps as typeof deps & { setNative: jest.Mock };
}

describe("shouldScheduleBackgroundSync", () => {
  it.each([
    [true, paired, true],
    [false, paired, false],
    [true, { enabled: false, deviceId: "device-1" }, false],
    [true, { enabled: true, deviceId: "" }, false],
  ])("setting %p with %p -> %p", (setting, state, expected) => {
    expect(shouldScheduleBackgroundSync(setting, state)).toBe(expected);
  });
});

describe("reconcileBackgroundSchedule", () => {
  it("schedules when opted in, sync is on and a vault exists", async () => {
    const deps = setup();
    await expect(reconcileBackgroundSchedule(deps, paired)).resolves.toBe(true);
    expect(deps.setNative.mock.calls).toEqual([[true]]);
  });

  it("cancels when the setting is off (the default)", async () => {
    const deps = setup({ readSetting: async () => false });
    await expect(reconcileBackgroundSchedule(deps, paired)).resolves.toBe(
      false,
    );
    expect(deps.setNative.mock.calls).toEqual([[false]]);
  });

  it("cancels when sync is paused, and when the device left the vault", async () => {
    const deps = setup();
    await reconcileBackgroundSchedule(deps, { enabled: false, deviceId: "d" });
    await reconcileBackgroundSchedule(deps, { enabled: true, deviceId: "" });
    expect(deps.setNative.mock.calls).toEqual([[false], [false]]);
  });

  it("is idempotent: repeated calls apply the same desired state", async () => {
    const deps = setup();
    await reconcileBackgroundSchedule(deps, paired);
    await reconcileBackgroundSchedule(deps, paired);
    expect(deps.setNative.mock.calls).toEqual([[true], [true]]);
  });

  it("does nothing, and never reads the setting, where the build cannot schedule", async () => {
    const deps = setup({ isAvailable: () => false });
    await expect(reconcileBackgroundSchedule(deps, paired)).resolves.toBe(
      false,
    );
    expect(deps.readSetting).not.toHaveBeenCalled();
    expect(deps.setNative).not.toHaveBeenCalled();
  });

  it("never rejects when the native call fails", async () => {
    const deps = setup({
      setNative: async () => {
        throw new Error("native");
      },
    });
    await expect(reconcileBackgroundSchedule(deps, paired)).resolves.toBe(
      false,
    );
  });
});
