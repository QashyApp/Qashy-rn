import { FULL_EXAMPLE, MINIMAL_EXAMPLE } from "@/theme/custom/examples";
import {
  evaluateThemeImport,
  exportCustomThemeJson,
  summarizeImportErrors,
  themeExportFilename,
} from "@/theme/custom/theme-import";

describe("evaluateThemeImport", () => {
  it("accepts a valid file and reports whether it replaces a stored theme", () => {
    const text = exportCustomThemeJson(MINIMAL_EXAMPLE);
    expect(evaluateThemeImport(text, [])).toMatchObject({
      ok: true,
      replaces: false,
      file: MINIMAL_EXAMPLE,
    });
    expect(
      evaluateThemeImport(text, [{ id: MINIMAL_EXAMPLE.id }]),
    ).toMatchObject({ ok: true, replaces: true });
  });

  it("tolerates a byte-order mark", () => {
    expect(
      evaluateThemeImport(`﻿${exportCustomThemeJson(FULL_EXAMPLE)}`, []).ok,
    ).toBe(true);
  });

  it("rejects text that is not JSON", () => {
    expect(evaluateThemeImport("{nope", [])).toEqual({
      ok: false,
      errors: ["$: the file is not valid JSON"],
    });
  });

  it("returns the validator errors, path-addressed, for an invalid theme", () => {
    const result = evaluateThemeImport(
      JSON.stringify({ ...MINIMAL_EXAMPLE, surprise: 1 }),
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("surprise");
  });

  it("shows at most five errors and counts the rest", () => {
    const errors = Array.from({ length: 8 }, (_, index) => `error ${index}`);
    expect(summarizeImportErrors(errors).split("\n")).toEqual([
      ...errors.slice(0, 5),
      "…and 3 more",
    ]);
    expect(summarizeImportErrors(["one"])).toBe("one");
  });

  it("names the export file after the theme id", () => {
    expect(themeExportFilename({ id: "moss-block" })).toBe(
      "qashy-theme-moss-block.json",
    );
  });
});
