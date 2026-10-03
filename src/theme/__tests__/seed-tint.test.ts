import { accentTokens } from "@/theme/theme";
import { classicTheme } from "@/theme/themes/classic";
import { materialYouTheme } from "@/theme/themes/material-you";

const SEED = "#E53935";

describe("seed-tinted surfaces", () => {
  it("washes Material You's background and surfaces with the picked accent", () => {
    for (const dark of [false, true]) {
      const scheme = dark ? "dark" : "light";
      const tokens = accentTokens(SEED, dark, materialYouTheme);
      const base = materialYouTheme.palette[scheme];
      expect(tokens.background).not.toBe(base.background);
      expect(tokens.surface).not.toBe(base.surface);
      // The surface leans toward the seed's red: red minus green grows.
      const redness = (hex: string) =>
        parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(3, 5), 16);
      expect(redness(tokens.background as string)).toBeGreaterThan(
        redness(base.background),
      );
    }
  });

  it("leaves themes without tintSurfaces untouched", () => {
    const tokens = accentTokens(SEED, false, classicTheme);
    expect(tokens.background).toBe(classicTheme.palette.light.background);
  });

  it("is deterministic", () => {
    expect(accentTokens(SEED, true, materialYouTheme).surface).toBe(
      accentTokens(SEED, true, materialYouTheme).surface,
    );
  });
});
