import { badgeColors, isMultiColorIcon } from "@/components/ui/icon-badge";
import { FONT_REGISTRY } from "@/theme/fonts";
import { ICON_SETS, getIconSet, resolveIconRender } from "@/theme/icon-sets";
import { materialStyle } from "@/theme/materials";
import { applyAppearanceOverrides } from "@/theme/overrides";
import { NO_SHADOW, flatShadowSet, shadowBlurs } from "@/theme/shadow";
import type { ThemeTokens } from "@/theme/theme";
import { classicTheme } from "@/theme/themes/classic";
import { materialYouTheme } from "@/theme/themes/material-you";
import {
  ROLE_TOKEN_KEYS,
  contrastRatio,
  derivedRoleTokens,
  lightTokens,
} from "@/theme/tokens";
import { parseIconId } from "@/utils/icon-id";

describe("applyAppearanceOverrides", () => {
  it("returns the same theme when nothing is overridden", () => {
    expect(applyAppearanceOverrides(classicTheme, {})).toBe(classicTheme);
    expect(
      applyAppearanceOverrides(classicTheme, {
        fontTextOverride: null,
        uiIconSetOverride: undefined,
      }),
    ).toBe(classicTheme);
  });

  it("ignores ids this build does not know", () => {
    expect(
      applyAppearanceOverrides(classicTheme, {
        fontTextOverride: "comic-sans",
        fontNumericOverride: "__proto__",
        uiIconSetOverride: "nope",
        categoryIconSetOverride: "constructor",
      }),
    ).toBe(classicTheme);
  });

  it("applies fonts with a Rubik fallback when the face lacks Hebrew", () => {
    const themed = applyAppearanceOverrides(classicTheme, {
      fontTextOverride: "inter",
      fontNumericOverride: "rubik",
    });
    expect(themed.type.text).toEqual({
      family: "inter",
      fallbacks: ["rubik"],
    });
    expect(themed.type.numeric.family).toBe("rubik");
    expect(themed.type.numeric.fallbacks ?? []).toEqual([]);
    for (const id of Object.keys(FONT_REGISTRY)) {
      const stack = applyAppearanceOverrides(classicTheme, {
        fontTextOverride: id,
      }).type.text;
      const hebrew = FONT_REGISTRY[id].scripts.includes("hebrew");
      expect(
        hebrew || id === "rubik" || stack.fallbacks?.includes("rubik"),
      ).toBe(true);
    }
  });

  it("keeps the category set following the theme unless it is overridden", () => {
    const ui = applyAppearanceOverrides(materialYouTheme, {
      uiIconSetOverride: "pixel",
    });
    expect(ui.icons.set).toBe("pixel");
    expect(ui.icons.categorySet).toBe(
      materialYouTheme.icons.categorySet ?? materialYouTheme.icons.set,
    );
    const both = applyAppearanceOverrides(materialYouTheme, {
      categoryIconSetOverride: "fluent-emoji-flat",
    });
    expect(both.icons.set).toBe(materialYouTheme.icons.set);
    expect(both.icons.categorySet).toBe("fluent-emoji-flat");
  });
});

describe("icon sets: material and fluent-emoji-flat", () => {
  it("registers both with matching ids", () => {
    for (const id of ["material", "fluent-emoji-flat"]) {
      expect(ICON_SETS[id]?.id).toBe(id);
    }
  });

  it("falls back to Ionicons for an unmapped glyph and never throws", () => {
    for (const id of ["material", "fluent-emoji-flat"]) {
      const render = resolveIconRender(parseIconId("ion:not-a-real-glyph"), id);
      expect(render.kind).toBeDefined();
    }
    expect(getIconSet("material").resolve("zzz-unmapped")).toBeNull();
    expect(getIconSet("fluent-emoji-flat").resolve("zzz-unmapped")).toBeNull();
  });

  it("covers the common category glyphs", () => {
    for (const id of ["material", "fluent-emoji-flat"]) {
      const covered = ["cart-outline", "home-outline", "car-outline"].filter(
        (glyph) => getIconSet(id).resolve(glyph) !== null,
      );
      expect(covered.length).toBeGreaterThan(0);
    }
  });

  it("emoji ids ignore the set and Fluent art counts as multicolor", () => {
    expect(isMultiColorIcon("emoji:🍕", "material")).toBe(true);
    const fluent = getIconSet("fluent-emoji-flat").resolve("cart-outline");
    if (fluent) {
      expect(isMultiColorIcon("ion:cart-outline", "fluent-emoji-flat")).toBe(
        true,
      );
    }
    expect(isMultiColorIcon("ion:cart-outline", "ionicons")).toBe(false);
  });
});

describe("flat engine", () => {
  it("has no blurred shadow except the fab and overlay", () => {
    for (const scheme of ["light", "dark"] as const) {
      const set = flatShadowSet(lightTokens, scheme);
      for (const key of [
        "shadowCard",
        "shadowRaised",
        "shadowControl",
        "shadowControlPressed",
        "shadowSunken",
      ] as const) {
        expect(shadowBlurs(set[key]).filter((blur) => blur > 0)).toEqual([]);
      }
      expect(set.shadowCard).toBe(NO_SHADOW);
      expect(set.shadowRaised).toBe(NO_SHADOW);
    }
  });

  it("material you is flat, gradient free and uses the overlay press", () => {
    expect(materialYouTheme.material.engine).toBe("flat");
    expect(materialYouTheme.material.gradients).toBe(false);
    expect(materialYouTheme.motion.press).toBe("overlay");
    expect(materialYouTheme.availableOn).toEqual(["android", "web"]);
  });
});

function tokensFor(cardStyle: ThemeTokens["cardStyle"]): ThemeTokens {
  return {
    ...(lightTokens as unknown as ThemeTokens),
    cardStyle,
    mode: "light",
    charts: classicTheme.charts,
    staticSurface: lightTokens.surface,
    staticText: lightTokens.text,
    accent: "#5966E9",
    onAccent: "#FFFFFF",
    gradients: false,
    surfaceGradient: undefined,
    shadowCard: "0px 1px 2px 0px rgba(0, 0, 0, 0.1)",
    shadowRaised: "0px 2px 4px 0px rgba(0, 0, 0, 0.1)",
  };
}

describe("material.card", () => {
  it("elevated keeps the theme shadow", () => {
    const theme = tokensFor("elevated");
    expect(materialStyle(theme, "card").boxShadow).toBe(theme.shadowCard);
  });

  it("outlined draws a hairline ring instead of a shadow", () => {
    const theme = tokensFor("outlined");
    const shadow = String(materialStyle(theme, "card").boxShadow);
    expect(shadow).toContain("inset");
    expect(shadowBlurs(shadow).filter((blur) => blur > 0)).toEqual([]);
  });

  it("tonal has neither ring nor shadow", () => {
    const theme = tokensFor("tonal");
    expect(materialStyle(theme, "card").boxShadow).toBe(NO_SHADOW);
    expect(materialStyle(theme, "raised").boxShadow).toBe(NO_SHADOW);
  });
});

describe("badgeColors", () => {
  const fallback = { container: "#EEEEEE", onContainer: "#111111" };
  const withBadge = (style: "tinted" | "filled" | "none") =>
    ({
      ...tokensFor("elevated"),
      iconBadge: { style, shape: "circle" },
    }) as ThemeTokens;

  it("tinted mixes the seed toward the surface", () => {
    const colors = badgeColors(withBadge("tinted"), "#D32F2F", { fallback });
    expect(colors.container).not.toBe("#D32F2F");
    expect(
      contrastRatio(String(colors.onContainer), String(colors.container)),
    ).toBeGreaterThan(3);
  });

  it("filled uses the seed with a readable glyph", () => {
    const colors = badgeColors(withBadge("filled"), "#D32F2F", { fallback });
    expect(colors.container).toBe("#D32F2F");
    expect(
      contrastRatio(String(colors.onContainer), "#D32F2F"),
    ).toBeGreaterThan(3);
  });

  it("filled keeps a tinted container for multicolor glyphs", () => {
    const colors = badgeColors(withBadge("filled"), "#D32F2F", {
      fallback,
      multiColor: true,
    });
    expect(colors.container).not.toBe("#D32F2F");
  });

  it("none has no container and the fallback applies without a seed", () => {
    expect(
      badgeColors(withBadge("none"), "#D32F2F", { fallback }).container,
    ).toBe("transparent");
    expect(badgeColors(withBadge("tinted"), undefined, { fallback })).toEqual(
      fallback,
    );
  });
});

describe("role tokens", () => {
  it("derives every role from a palette, readable on its container", () => {
    for (const dark of [false, true]) {
      const roles = derivedRoleTokens(lightTokens, dark);
      for (const key of ROLE_TOKEN_KEYS)
        expect(roles[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(
        contrastRatio(roles.onSecondaryContainer, roles.secondaryContainer),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(roles.onTertiaryContainer, roles.tertiaryContainer),
      ).toBeGreaterThanOrEqual(4.5);
      expect(roles.headerBackground).toBe(lightTokens.background);
      expect(roles.navBackground).toBe(lightTokens.surfaceElevated);
    }
  });
});
