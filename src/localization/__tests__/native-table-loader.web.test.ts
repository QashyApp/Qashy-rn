import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EMPTY_NATIVE_TABLE } from "@/localization/native-table";
import { loadNativeTable } from "@/localization/native-table-loader.web";

const mockGetStrings = jest.fn();
jest.mock("../../../modules/qashy-locale", () => ({
  getStrings: (...args: unknown[]) => mockGetStrings(...args),
}));

describe("the web table loader", () => {
  it("never reads native and resolves to the empty English table", async () => {
    await expect(loadNativeTable("fr-FR")).resolves.toBe(EMPTY_NATIVE_TABLE);
    expect(mockGetStrings).not.toHaveBeenCalled();
  });

  it("imports neither the runtime list nor the native module, so the web bundle has neither", () => {
    const source = readFileSync(
      join(__dirname, "..", "native-table-loader.web.ts"),
      "utf8",
    );
    const imports = source.match(/^import[\s\S]*?from\s+"[^"]+";$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      expect(statement).not.toMatch(/android-runtime|qashy-locale/);
    }
    // The shared table module is the only other place the runtime list could leak in from.
    const shared = readFileSync(
      join(__dirname, "..", "native-table.ts"),
      "utf8",
    );
    expect(shared).not.toMatch(/^import .*android-runtime/m);
    expect(shared).not.toMatch(/^import .*qashy-locale/m);
  });
});
