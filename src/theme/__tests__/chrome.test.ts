import { resolveAccentChoice } from "@/theme/theme";
import { classicTheme } from "@/theme/themes/classic";
import { materialYouTheme } from "@/theme/themes/material-you";
import {
  getTheme,
  isThemeAvailable,
  listAvailableThemes,
} from "@/theme/themes/registry";
import { assertThemeDefinition } from "@/theme/themes/validate";

const user = { accentSource: "custom" as const, accentHex: "#00A58E" };
const system = { accentSource: "system" as const, accentHex: "#00A58E" };

describe("platform availability", () => {
  it("falls back to classic where the theme is not offered", () => {
    expect(getTheme("material-you", [], "ios")).toBe(classicTheme);
    expect(getTheme("material-you", [], "web")).toBe(materialYouTheme);
    expect(getTheme("material-you", [], "android")).toBe(materialYouTheme);
  });

  it("lists only available themes", () => {
    expect(listAvailableThemes([], "ios").map((t) => t.id)).not.toContain(
      "material-you",
    );
    expect(listAvailableThemes([], "android").map((t) => t.id)).toContain(
      "material-you",
    );
    expect(listAvailableThemes([], "web").map((t) => t.id)).toContain(
      "material-you",
    );
    expect(
      listAvailableThemes([], "ios")
        .map((t) => t.id)
        .sort(),
    ).toEqual(["classic", "high-contrast"]);
    expect(isThemeAvailable(classicTheme, "web")).toBe(true);
  });

  it("material-you is a valid theme", () => {
    expect(() => assertThemeDefinition(materialYouTheme)).not.toThrow();
  });
});

describe("resolveAccentChoice", () => {
  it("user mode follows the settings", () => {
    expect(resolveAccentChoice(classicTheme, user)).toEqual({
      kind: "seed",
      seed: "#00A58E",
    });
    expect(resolveAccentChoice(classicTheme, system)).toEqual({
      kind: "system",
    });
  });

  it("material-you follows the settings, defaulting to the system accent", () => {
    expect(resolveAccentChoice(materialYouTheme, user)).toEqual({
      kind: "seed",
      seed: "#00A58E",
    });
    expect(resolveAccentChoice(materialYouTheme, system)).toEqual({
      kind: "system",
    });
  });

  it("system mode ignores the settings", () => {
    const systemOnly = {
      ...classicTheme,
      accent: { ...classicTheme.accent, mode: "system" as const },
    };
    expect(resolveAccentChoice(systemOnly, user)).toEqual({ kind: "system" });
  });

  it("fixed mode uses the theme default", () => {
    const fixed = {
      ...classicTheme,
      accent: { ...classicTheme.accent, mode: "fixed" as const },
    };
    expect(resolveAccentChoice(fixed, user)).toEqual({
      kind: "seed",
      seed: classicTheme.accent.default,
    });
    expect(resolveAccentChoice(fixed, system)).toEqual({
      kind: "seed",
      seed: classicTheme.accent.default,
    });
  });
});
