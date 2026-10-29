import * as Haptics from "expo-haptics";

import {
  hapticError,
  hapticImpactLight,
  hapticSelection,
  hapticSuccess,
  hapticWarning,
  setHapticsEnabled,
} from "@/services/haptics";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
  AndroidHaptics: {
    Confirm: "confirm",
    Reject: "reject",
    Clock_Tick: "clock-tick",
    Context_Click: "context-click",
    Long_Press: "long-press",
  },
}));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const perform = Haptics.performAndroidHapticsAsync as jest.Mock;

describe("haptics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    perform.mockImplementation(() => Promise.resolve());
    setHapticsEnabled(true);
  });

  it("plays the platform's own haptic constants", () => {
    hapticSelection();
    hapticImpactLight();
    hapticSuccess();
    hapticError();
    hapticWarning();
    expect(perform.mock.calls.map(([type]) => type)).toEqual([
      "clock-tick",
      "context-click",
      "confirm",
      "reject",
      "long-press",
    ]);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("falls back to the vibrator waveforms when the constant is unsupported", async () => {
    perform.mockImplementation(() => Promise.reject(new Error("API level")));
    hapticSelection();
    hapticImpactLight();
    hapticSuccess();
    hapticError();
    hapticWarning();
    await flush();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
    expect(
      (Haptics.notificationAsync as jest.Mock).mock.calls.map(([type]) => type),
    ).toEqual(["success", "error", "warning"]);
  });

  it("never throws when the fallback fails too", async () => {
    perform.mockImplementation(() => Promise.reject(new Error("API level")));
    (Haptics.selectionAsync as jest.Mock).mockImplementationOnce(() =>
      Promise.reject(new Error("no vibrator")),
    );
    expect(() => hapticSelection()).not.toThrow();
    await flush();
  });

  it("goes silent when the device turns haptics off, and resumes when it is back on", () => {
    setHapticsEnabled(false);
    hapticSelection();
    hapticSuccess();
    expect(perform).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    setHapticsEnabled(true);
    hapticSuccess();
    expect(perform).toHaveBeenCalledWith("confirm");
  });
});
