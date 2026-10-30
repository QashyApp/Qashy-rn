import { requireHandedOff, saveFile } from "@/features/shared/save-file";

const mockFile = {
  exists: false,
  uri: "file:///cache/x.csv",
  delete: jest.fn(),
  create: jest.fn(),
  write: jest.fn(),
};
const mockIsAvailable = jest.fn();
const mockShare = jest.fn();

jest.mock("expo-file-system", () => ({
  File: jest.fn(() => mockFile),
  Paths: { cache: "cache" },
}));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => mockIsAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

describe("saveFile", () => {
  beforeEach(() => {
    mockIsAvailable.mockReset();
    mockShare.mockReset().mockResolvedValue(undefined);
  });

  it("reports a file handed to the share sheet as shared", async () => {
    mockIsAvailable.mockResolvedValue(true);

    const result = await saveFile(
      "x.csv",
      "text/csv;charset=utf-8",
      "a,b",
      "Export",
    );

    expect(result).toBe("shared");
    expect(mockShare).toHaveBeenCalledWith("file:///cache/x.csv", {
      mimeType: "text/csv",
      dialogTitle: "Export",
    });
    expect(() => requireHandedOff(result)).not.toThrow();
  });

  it("says so when the platform cannot share, instead of resolving as if it had", async () => {
    mockIsAvailable.mockResolvedValue(false);

    const result = await saveFile("x.csv", "text/csv", "a,b", "Export");

    expect(result).toBe("unavailable");
    expect(mockShare).not.toHaveBeenCalled();
    expect(() => requireHandedOff(result)).toThrow(/isn’t available/);
  });

  it("treats a browser download as handed off", () => {
    expect(() => requireHandedOff("downloaded")).not.toThrow();
  });
});
