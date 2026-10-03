import { materialStyle, type Material } from "@/theme/materials";
import { accentTokens } from "@/theme/theme";
import { classicTheme } from "@/theme/themes/classic";
import { bevelShadowSet, shadowBlurs } from "@/theme/shadow";
import type { ThemeDefinition } from "@/theme/themes/types";
import { assertThemeDefinition } from "@/theme/themes/validate";

const MATERIALS: Material[] = [
  "card",
  "raised",
  "sunken",
  "control",
  "controlPressed",
  "accent",
  "accentPressed",
  "selected",
  "overlay",
  "well",
];

const bevelTheme: ThemeDefinition = {
  ...classicTheme,
  id: "bevel-test",
  name: "Bevel test",
  material: {
    engine: "bevel",
    card: "elevated",
    gradients: false,
    bevelDepth: 2,
  },
  motion: { ...classicTheme.motion, press: "translate", pressTranslate: 2 },
  shadows: {
    light: bevelShadowSet(classicTheme.palette.light, "light", 2),
    dark: bevelShadowSet(classicTheme.palette.dark, "dark", 2),
  },
};

describe("bevel theme", () => {
  it("passes validation", () => {
    expect(() => assertThemeDefinition(bevelTheme)).not.toThrow();
  });

  it.each([false, true])(
    "renders every material with no blur and no gradient (dark=%s)",
    (dark) => {
      const tokens = accentTokens("#5966E9", dark, bevelTheme);
      for (const material of MATERIALS) {
        const style = materialStyle(tokens, material) as Record<
          string,
          unknown
        >;
        expect(typeof style.boxShadow).toBe("string");
        expect({
          material,
          blurs: shadowBlurs(style.boxShadow as string).filter(
            (blur) => blur > 0,
          ),
        }).toEqual({ material, blurs: [] });
        expect(
          style.experimental_backgroundImage ?? style.backgroundImage,
        ).toBeUndefined();
      }
    },
  );

  it("is rejected when a bevel shadow blurs", () => {
    const blurry: ThemeDefinition = {
      ...bevelTheme,
      shadows: {
        ...bevelTheme.shadows,
        light: {
          ...bevelTheme.shadows.light,
          shadowCard: "0 8px 20px rgba(0,0,0,0.2)",
        },
      },
    };
    expect(() => assertThemeDefinition(blurry)).toThrow(/no blur/);
  });

  it("keeps gradients for classic", () => {
    const style = materialStyle(
      accentTokens("#5966E9", false, classicTheme),
      "card",
    ) as Record<string, unknown>;
    expect(
      style.experimental_backgroundImage ?? style.backgroundImage,
    ).toBeDefined();
  });

  it("rejects a bad press mode", () => {
    expect(() =>
      assertThemeDefinition({
        ...classicTheme,
        motion: { ...classicTheme.motion, press: "wiggle" as never },
      }),
    ).toThrow(/press/);
  });
});
