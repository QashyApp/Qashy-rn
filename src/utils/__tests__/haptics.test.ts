import * as Haptics from "expo-haptics";

import {
  hapticError,
  hapticSelection,
  hapticSuccess,
  setHapticsEnabled,
} from "@/utils/haptics";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

describe("haptics preference", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHapticsEnabled(true);
  });

  it("fires when enabled", () => {
    hapticSelection();
    hapticError();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("error");
  });

  it("goes silent when the device turns haptics off, and resumes when it is back on", () => {
    setHapticsEnabled(false);
    hapticSelection();
    hapticSuccess();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    setHapticsEnabled(true);
    hapticSuccess();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });
});
