import { resolveWidgetPalettes, toHex6 } from "@/features/widgets/palette";
import type { Palette } from "@/features/widgets/palette";
import { contrastRatio } from "@/theme/tokens";

const SETTINGS = {
  themeId: "classic",
  accentSource: "custom" as const,
  accentHex: "#5070FF",
};
const SURFACE = { background: "surface" as const, customColor: null };
const HEX = /^#[0-9A-F]{6}$/;

const allColors = (palette: Palette) => Object.values(palette);

describe("toHex6", () => {
  it("converts every color form and drops alpha", () => {
    expect(toHex6("#abc", "#000000")).toBe("#AABBCC");
    expect(toHex6("#abcd", "#000000")).toBe("#AABBCC");
    expect(toHex6("#a1b2c3", "#000000")).toBe("#A1B2C3");
    expect(toHex6("#a1b2c3cc", "#000000")).toBe("#A1B2C3");
    expect(toHex6("rgb(255, 0, 128)", "#000000")).toBe("#FF0080");
    expect(toHex6("rgba(1, 2, 3, 0.5)", "#000000")).toBe("#010203");
  });

  it("uses the fallback for anything it cannot read", () => {
    expect(toHex6("rebeccapurple", "#123456")).toBe("#123456");
    expect(toHex6(undefined, "#123456")).toBe("#123456");
    expect(toHex6(7, "#123456")).toBe("#123456");
  });
});

describe("resolveWidgetPalettes", () => {
  it("returns #RRGGBB for every role in both schemes", () => {
    const { light, dark } = resolveWidgetPalettes(SURFACE, SETTINGS);
    for (const color of [...allColors(light), ...allColors(dark)])
      expect(color).toMatch(HEX);
  });

  it("uses the theme surface and keeps light and dark apart", () => {
    const { light, dark } = resolveWidgetPalettes(SURFACE, SETTINGS);
    expect(light.background).not.toBe(dark.background);
    expect(contrastRatio(light.text, light.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(dark.text, dark.background)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("follows the user's accent", () => {
    const blue = resolveWidgetPalettes(SURFACE, SETTINGS);
    const red = resolveWidgetPalettes(SURFACE, {
      ...SETTINGS,
      accentHex: "#D32F2F",
    });
    expect(red.light.accent).not.toBe(blue.light.accent);
  });

  it("keeps a readable onAccent on the accent, for the accent background", () => {
    for (const accentHex of ["#FFEB3B", "#1A237E", "#5070FF", "#00E676"]) {
      const palettes = resolveWidgetPalettes(
        { background: "accent", customColor: null },
        { ...SETTINGS, accentHex },
      );
      for (const palette of [palettes.light, palettes.dark])
        expect(
          contrastRatio(palette.onAccent, palette.accent),
        ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("falls back to Classic for an unknown theme id", () => {
    expect(
      resolveWidgetPalettes(SURFACE, { ...SETTINGS, themeId: "custom:gone" }),
    ).toEqual(resolveWidgetPalettes(SURFACE, SETTINGS));
  });

  it("resolves a system accent without wallpaper palettes to real hex", () => {
    const { light, dark } = resolveWidgetPalettes(SURFACE, {
      ...SETTINGS,
      accentSource: "system",
    });
    for (const color of [...allColors(light), ...allColors(dark)])
      expect(color).toMatch(HEX);
  });

  describe("custom background", () => {
    const COLORS = [
      "#000000",
      "#FFFFFF",
      "#7F7F7F",
      "#808080",
      "#767676",
      "#FFD400",
      "#1A237E",
      "#FF0000",
      "#00FF00",
      "#0000FF",
      "#E8EAF6",
      "#263238",
      "#FF6F00",
    ];

    it.each(COLORS)("keeps text and statuses readable on %s", (customColor) => {
      const { light, dark } = resolveWidgetPalettes(
        { background: "custom", customColor },
        SETTINGS,
      );
      for (const palette of [light, dark]) {
        expect(palette.background).toBe(customColor);
        for (const role of [
          "text",
          "textMuted",
          "positive",
          "negative",
        ] as const) {
          expect(palette[role]).toMatch(HEX);
          expect(
            contrastRatio(palette[role], palette.background),
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(palette.border).toMatch(HEX);
      }
    });

    it("uses the same background in both schemes", () => {
      const { light, dark } = resolveWidgetPalettes(
        { background: "custom", customColor: "#336699" },
        SETTINGS,
      );
      expect(light.background).toBe("#336699");
      expect(dark.background).toBe("#336699");
    });

    it("ignores a missing custom color and keeps the surface", () => {
      expect(
        resolveWidgetPalettes(
          { background: "custom", customColor: null },
          SETTINGS,
        ),
      ).toEqual(resolveWidgetPalettes(SURFACE, SETTINGS));
    });
  });
});
