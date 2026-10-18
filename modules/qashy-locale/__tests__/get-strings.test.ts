import { Platform } from "react-native";

const mockGetStrings = jest.fn();

jest.mock("../src/QashyLocaleModule", () => ({
  __esModule: true,
  default: {
    getStrings: (...args: unknown[]) => mockGetStrings(...args),
  },
}));

import { getStrings } from "../index";

const originalOS = Platform.OS;
function setOS(os: string): void {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

afterEach(() => {
  setOS(originalOS);
  mockGetStrings.mockReset();
});

describe("getStrings", () => {
  it("passes names and locale to the native module on Android", async () => {
    setOS("android");
    mockGetStrings.mockResolvedValue(["Save", null]);
    await expect(getStrings(["q_a", "q_b"], "he")).resolves.toEqual([
      "Save",
      null,
    ]);
    expect(mockGetStrings).toHaveBeenCalledWith(["q_a", "q_b"], "he");
  });

  it("resolves to all nulls on web without calling native", async () => {
    setOS("web");
    await expect(getStrings(["q_a", "q_b"], "he")).resolves.toEqual([
      null,
      null,
    ]);
    expect(mockGetStrings).not.toHaveBeenCalled();
  });

  it("rejects when the native call fails, so the caller can retry", async () => {
    setOS("android");
    mockGetStrings.mockRejectedValue(new Error("boom"));
    await expect(getStrings(["q_a"], "en")).rejects.toThrow("boom");
  });

  it("pads a short native result with nulls", async () => {
    setOS("android");
    mockGetStrings.mockResolvedValue(["x"]);
    await expect(getStrings(["q_a", "q_b"], "en")).resolves.toEqual([
      "x",
      null,
    ]);
  });

  it("returns [] for no names without calling native", async () => {
    setOS("android");
    await expect(getStrings([], "en")).resolves.toEqual([]);
    expect(mockGetStrings).not.toHaveBeenCalled();
  });
});
