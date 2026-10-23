import { Alert } from "react-native";

import { showError } from "@/utils/confirm";
import { hapticError } from "@/services/haptics";

jest.mock("@/services/haptics", () => ({
  hapticError: jest.fn(),
  hapticWarning: jest.fn(),
}));

describe("showError haptics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  it("buzzes an error with the dialog", () => {
    showError("Couldn’t save account", "Try again.");

    expect(hapticError).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it("shows a notice that is not a failure without the error buzz", () => {
    showError("Import complete", "3 transactions imported.", { quiet: true });

    expect(hapticError).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
