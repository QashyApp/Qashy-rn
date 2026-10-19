import { EMPTY_NATIVE_TABLE } from "@/localization/native-table";
import { loadNativeTable } from "@/localization/native-table-loader.native";
import { resourceName } from "@/localization/resource-names";

// The native module itself is mocked, so the real `getStrings` wrapper runs.
const mockModule: {
  current: { getStrings: jest.Mock } | null;
} = { current: null };
jest.mock("../../../modules/qashy-locale/src/QashyLocaleModule", () => ({
  __esModule: true,
  get default() {
    return mockModule.current;
  },
}));

describe("the native table loader", () => {
  afterEach(() => {
    mockModule.current = null;
  });

  it("returns the empty table, never a good one, when the module is absent", async () => {
    mockModule.current = null;
    await expect(loadNativeTable("fr-FR")).resolves.toBe(EMPTY_NATIVE_TABLE);
  });

  it("returns the empty table when every value comes back null", async () => {
    const getStrings = jest.fn(async (names: string[]) =>
      names.map(() => null),
    );
    mockModule.current = { getStrings };
    await expect(loadNativeTable("fr-FR")).resolves.toBe(EMPTY_NATIVE_TABLE);
    expect(getStrings).toHaveBeenCalledTimes(1);
  });

  it("builds a table as soon as one value is present", async () => {
    mockModule.current = {
      getStrings: jest.fn(async (names: string[]) =>
        names.map((name) =>
          name === resourceName("Language") ? "Langue" : null,
        ),
      ),
    };
    const table = await loadNativeTable("fr-FR");
    expect(table).not.toBe(EMPTY_NATIVE_TABLE);
    expect(table.strings.get("Language")).toBe("Langue");
  });

  it("rejects when the native read does", async () => {
    mockModule.current = {
      getStrings: jest.fn().mockRejectedValue(new Error("boom")),
    };
    await expect(loadNativeTable("fr-FR")).rejects.toThrow("boom");
  });
});
