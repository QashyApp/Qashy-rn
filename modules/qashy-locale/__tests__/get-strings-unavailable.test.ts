import { Platform } from "react-native";

jest.mock("../src/QashyLocaleModule", () => ({
  __esModule: true,
  default: null,
}));

import { getStrings } from "../index";

describe("getStrings without the native module", () => {
  it("resolves to all nulls", async () => {
    expect(Platform.OS).toBe("android");
    await expect(getStrings(["q_a", "q_b"], "he")).resolves.toEqual([
      null,
      null,
    ]);
  });
});
