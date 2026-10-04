import { materialRoles } from "@/theme/material-scheme";
import { materialYouTheme } from "@/theme/themes/material-you";
import { contrastRatio } from "@/theme/tokens";

const SEED = "#6750A4";

describe("materialRoles", () => {
  for (const scheme of ["light", "dark"] as const) {
    const base = materialYouTheme.palette[scheme];
    const roles = materialRoles(SEED, scheme, base);

    it(`${scheme}: returns well-formed hex roles`, () => {
      for (const value of [
        roles.primary,
        roles.onPrimary,
        roles.primaryContainer,
        roles.onPrimaryContainer,
        roles.outline,
        roles.inverseSurface,
        roles.inverseOnSurface,
        roles.inversePrimary,
      ]) {
        expect(value).toMatch(/^#[0-9A-F]{6}$/);
      }
    });

    it(`${scheme}: pairs are readable`, () => {
      expect(
        contrastRatio(roles.onPrimary, roles.primary),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(roles.onPrimaryContainer, roles.primaryContainer),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(roles.inverseOnSurface, roles.inverseSurface),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scheme}: keeps the base semantic colors`, () => {
      expect(roles.palette.positive).toBe(base.positive);
      expect(roles.palette.negative).toBe(base.negative);
    });
  }

  it("orders the surface containers by elevation in both modes", () => {
    const lum = (hex: string) => contrastRatio(hex, "#000000");
    const light = materialRoles(SEED, "light", materialYouTheme.palette.light);
    const dark = materialRoles(SEED, "dark", materialYouTheme.palette.dark);
    // Light mode gets darker with elevation; dark mode gets lighter.
    expect(lum(light.palette.surfaceSunken)).toBeLessThan(
      lum(light.palette.surface),
    );
    expect(lum(dark.palette.surfaceSunken)).toBeGreaterThan(
      lum(dark.palette.surface),
    );
  });

  it("is deterministic", () => {
    const base = materialYouTheme.palette.light;
    expect(materialRoles(SEED, "light", base)).toEqual(
      materialRoles(SEED, "light", base),
    );
  });
});
