import {
  deriveDynamicPalette,
  isSystemPalettes,
  type SystemPalettes,
} from "@/theme/dynamic-palette";
import { contrastRatio, darkTokens, lightTokens } from "@/theme/tokens";

const TONES = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

// Linear ramp from `from` (tone 0) to `to` (tone 1000): a fixed, reproducible "wallpaper".
function ramp(from: string, to: string): Record<string, string> {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const out: Record<string, string> = {};
  for (const tone of TONES) {
    const t = tone / 1000;
    const parts = [1, 3, 5].map((i) =>
      Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t)
        .toString(16)
        .padStart(2, "0"),
    );
    out[String(tone)] = `#${parts.join("").toUpperCase()}`;
  }
  return out;
}

const grey: SystemPalettes = {
  accent1: ramp("#FFFFFF", "#000000"),
  accent2: ramp("#FFFFFF", "#000000"),
  accent3: ramp("#FFFFFF", "#000000"),
  neutral1: ramp("#FFFFFF", "#000000"),
  neutral2: ramp("#FFFFFF", "#000000"),
};
const violet: SystemPalettes = {
  accent1: ramp("#F2EBFF", "#14003D"),
  accent2: ramp("#F1ECFA", "#150F2A"),
  accent3: ramp("#FFEBF1", "#2E0014"),
  neutral1: ramp("#FFFBFF", "#0F0D12"),
  neutral2: ramp("#FBF8FF", "#16131B"),
};

describe("deriveDynamicPalette", () => {
  it("maps tones to roles in light mode", () => {
    const { palette, seed, accentContainer, onAccentContainer } =
      deriveDynamicPalette(violet, "light", lightTokens);
    expect(palette.background).toBe(violet.neutral1["10"]);
    expect(palette.surfaceElevated).toBe(violet.neutral1["50"]);
    expect(palette.secondaryContainer).toBe(violet.accent2["100"]);
    expect(palette.tertiaryContainer).toBe(violet.accent3["100"]);
    expect(seed).toBe(violet.accent1["600"]);
    expect(accentContainer).toBe(violet.accent1["100"]);
    expect(onAccentContainer).toBe(violet.accent1["900"]);
  });

  it("maps tones to roles in dark mode", () => {
    const { palette, seed, accentContainer } = deriveDynamicPalette(
      violet,
      "dark",
      darkTokens,
    );
    expect(palette.surface).toBe(violet.neutral1["900"]);
    expect(palette.secondaryContainer).toBe(violet.accent2["700"]);
    expect(seed).toBe(violet.accent1["200"]);
    expect(accentContainer).toBe(violet.accent1["700"]);
  });

  it("keeps the base semantic colors", () => {
    const { palette } = deriveDynamicPalette(violet, "light", lightTokens);
    expect(palette.positive).toBe(lightTokens.positive);
    expect(palette.negative).toBe(lightTokens.negative);
    expect(palette.transfer).toBe(lightTokens.transfer);
  });

  it.each([
    ["light", lightTokens],
    ["dark", darkTokens],
  ] as const)("keeps text readable in %s", (scheme, base) => {
    for (const source of [grey, violet]) {
      const { palette } = deriveDynamicPalette(source, scheme, base);
      for (const surface of [palette.surface, palette.background]) {
        expect(contrastRatio(palette.text, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrastRatio(palette.textMuted, palette.surface),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is deterministic", () => {
    expect(deriveDynamicPalette(violet, "dark", darkTokens)).toEqual(
      deriveDynamicPalette(violet, "dark", darkTokens),
    );
  });
});

describe("isSystemPalettes", () => {
  it("accepts a complete palette set", () => {
    expect(isSystemPalettes(violet)).toBe(true);
  });
  it("rejects null, partial and malformed values", () => {
    expect(isSystemPalettes(null)).toBe(false);
    expect(isSystemPalettes({})).toBe(false);
    expect(isSystemPalettes({ ...violet, accent3: { "0": "#FFF" } })).toBe(false);
    expect(
      isSystemPalettes({
        ...violet,
        neutral1: { ...violet.neutral1, "500": "red" },
      }),
    ).toBe(false);
  });
});
