import { clampPaletteContrast, TEXT_SURFACES } from "@/theme/custom/contrast";
import { classicTheme } from "@/theme/themes/classic";
import { assertThemeDefinition } from "@/theme/themes/validate";
import { contrastRatio, lightTokens } from "@/theme/tokens";

describe("contrast clamp covers every text-bearing surface", () => {
  it("lists the sunken and muted wells alongside the page surfaces", () => {
    expect(TEXT_SURFACES).toEqual(
      expect.arrayContaining([
        "surface",
        "surfaceElevated",
        "background",
        "surfaceSunken",
        "surfaceMuted",
      ]),
    );
  });

  it("darkens faint text on a slightly darker sunken form well", () => {
    const palette = {
      ...lightTokens,
      text: "#9A9A9A",
      surfaceSunken: "#D5D8DE",
    };
    const result = clampPaletteContrast("light", palette);
    expect(result.unsatisfied).toEqual([]);
    expect(
      contrastRatio(result.palette.text, result.palette.surfaceSunken),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      result.warnings.some((line) => line.includes("against surfaceSunken")),
    ).toBe(true);
  });

  it("reports text that cannot read on both a light surface and a dark sunken well", () => {
    const palette = {
      ...lightTokens,
      text: "#222222",
      surfaceSunken: "#333333",
    };
    const result = clampPaletteContrast("light", palette);
    expect(
      result.unsatisfied.some((line) => line.includes("surfaceSunken")),
    ).toBe(true);
  });

  it("clamps textMuted against a light muted well", () => {
    const palette = {
      ...lightTokens,
      text: "#111111",
      textMuted: "#999999",
      surfaceMuted: "#D0D0D0",
    };
    const result = clampPaletteContrast("light", palette);
    for (const surface of TEXT_SURFACES) {
      expect(
        contrastRatio(result.palette.textMuted, result.palette[surface]),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("clamps a status color on a mid-grey sunken well", () => {
    const palette = { ...lightTokens, surfaceSunken: "#808080" };
    const result = clampPaletteContrast("light", palette);
    for (const surface of TEXT_SURFACES) {
      expect(
        contrastRatio(result.palette.positive, result.palette[surface]),
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("charts.tone.containerMix range", () => {
  const withMix = (light: number) => ({
    ...classicTheme,
    id: "mix-check",
    name: "Mix",
    charts: {
      ...classicTheme.charts,
      tone: { ...classicTheme.charts.tone, containerMix: { light, dark: 0.7 } },
    },
  });

  it("accepts 0.4, the documented floor", () => {
    expect(() => assertThemeDefinition(withMix(0.4))).not.toThrow();
  });

  it("rejects values below 0.4", () => {
    expect(() => assertThemeDefinition(withMix(0.39))).toThrow(
      /between 0\.4 and 0\.95/,
    );
  });
});
