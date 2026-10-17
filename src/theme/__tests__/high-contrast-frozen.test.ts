import { highContrastTheme } from "@/theme/themes/high-contrast";

/**
 * High contrast is deliberately frozen out of the shared scale evolution: it carries local copies
 * of the tile, icon, motion and type scales (see the header comment in `high-contrast.ts`), so a
 * change to `@/theme/tokens` — the Dew look, or anything later — cannot move it. These pins are
 * that contract; if a future edit re-binds High contrast to the shared tokens, they fail here
 * rather than in someone's accessibility setting.
 */
describe("high contrast stays frozen", () => {
  it("keeps its pre-Dew motion", () => {
    expect(highContrastTheme.motion).toEqual({
      duration: { fast: 120, base: 200, slow: 320 },
      spring: {
        snappy: { damping: 22, stiffness: 320, mass: 0.8 },
        gentle: { damping: 20, stiffness: 180, mass: 1 },
        emphasized: { damping: 16, stiffness: 220, mass: 1 },
      },
      pressScale: 0.97,
      press: "scale",
      pressTranslate: 0,
    });
  });

  it("keeps its tile and icon scales", () => {
    expect(highContrastTheme.tile).toEqual({
      size: 40,
      icon: 20,
      compactSize: 32,
      compactIcon: 16,
    });
    expect(highContrastTheme.iconSize).toEqual({
      sm: 16,
      md: 20,
      lg: 24,
      xl: 32,
    });
  });

  it("keeps its shape and type floor", () => {
    expect(highContrastTheme.radius).toEqual({
      sm: 6,
      control: 8,
      tile: 8,
      card: 12,
      sheet: 16,
      nav: 10,
      fab: 999,
      pill: 999,
    });
    const scale = highContrastTheme.type.scale;
    expect(scale.hero).toEqual({
      fontSize: 48,
      lineHeight: 54,
      weight: "semibold",
      letterSpacing: -1.6,
    });
    expect(scale.body).toEqual({
      fontSize: 17,
      lineHeight: 24,
      weight: "regular",
      letterSpacing: 0,
    });
    expect(scale.eyebrow).toEqual({
      fontSize: 12,
      lineHeight: 16,
      weight: "semibold",
      letterSpacing: 0.6,
    });
  });
});
