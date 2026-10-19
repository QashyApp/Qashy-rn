import { Platform } from "react-native";

import { getStrings } from "../index";

jest.mock("../src/QashyLocaleModule", () => ({
  __esModule: true,
  default: null,
}));

describe("getStrings without the native module", () => {
  it("resolves to all nulls", async () => {
    expect(Platform.OS).toBe("android");
    await expect(getStrings(["q_a", "q_b"], "he")).resolves.toEqual([
      null,
      null,
    ]);
  });
});
