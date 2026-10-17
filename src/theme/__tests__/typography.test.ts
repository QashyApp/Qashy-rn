import {
  fontIdsForTheme,
  isRegisteredFamily,
  scriptsCovered,
} from "@/theme/fonts";
import { classicTheme } from "@/theme/themes/classic";
import type { TypeSpec } from "@/theme/themes/types";
import { fontFamilies, numericFontFamilies } from "@/theme/tokens";
import {
  FONT_ASSETS,
  fontStyle,
  numericFontStyle,
  withAppFont,
} from "@/theme/typography";

// Jest runs with EXPO_OS === 'ios' by default (see jest-expo's babel caller
// platform), so these assert the native branch: a bare family, no fontWeight.
describe("numericFontStyle", () => {
  it("resolves each weight to its Figtree family on native for the default theme", () => {
    expect(numericFontStyle("medium").fontFamily).toBe("Figtree_500Medium");
    expect(numericFontStyle("semibold").fontFamily).toBe("Figtree_600SemiBold");
    expect(numericFontStyle("bold").fontFamily).toBe("Figtree_700Bold");
    expect(numericFontStyle("regular").fontFamily).toBe("Figtree_400Regular");
  });

  it("falls back a missing weight file to the nearest bundled one", () => {
    const grotesk: TypeSpec = {
      text: { family: "rubik", fallbacks: [] },
      numeric: { family: "space-grotesk", fallbacks: [] },
      scale: classicTheme.type.scale,
    };
    expect(numericFontStyle("regular", grotesk).fontFamily).toBe(
      numericFontFamilies.medium,
    );
  });
});

describe("withAppFont numeric face", () => {
  it("maps fontWeight 700 to Figtree_700Bold", () => {
    const resolved = withAppFont({ fontWeight: "700" }, "regular", "numeric");
    expect(resolved.fontFamily).toBe("Figtree_700Bold");
  });

  it("still resolves the text face (Figtree) when face is omitted", () => {
    const resolved = withAppFont({}, "bold");
    expect(resolved.fontFamily).toBe("Figtree_700Bold");
  });

  it('treats an existing SpaceGrotesk family as "ours" and still overrides it', () => {
    const resolved = withAppFont(
      { fontFamily: numericFontFamilies.medium, fontWeight: "600" },
      "regular",
      "numeric",
    );
    expect(resolved.fontFamily).toBe("Figtree_600SemiBold");
  });
});

describe("theme-aware typography", () => {
  const latinThenRubik: TypeSpec = {
    ...classicTheme.type,
    text: { family: "space-grotesk", fallbacks: ["rubik"] },
  };

  it("classic native output uses the theme faces (Figtree text and numbers)", () => {
    expect(fontStyle("regular")).toEqual({
      fontFamily: "Figtree_400Regular",
      fontWeight: undefined,
    });
    expect(fontStyle("bold")).toEqual({
      fontFamily: "Figtree_700Bold",
      fontWeight: undefined,
    });
    expect(numericFontStyle("regular")).toEqual({
      fontFamily: "Figtree_400Regular",
      fontWeight: undefined,
    });
  });

  it("keeps FONT_ASSETS equal to the pre-registry map plus the newer bundled faces", () => {
    expect(Object.keys(FONT_ASSETS).sort()).toEqual(
      [
        ...Object.values(fontFamilies),
        ...Object.values(numericFontFamilies),
        "PixelifySans_400Regular",
        "PixelifySans_500Medium",
        "PixelifySans_600SemiBold",
        "PixelifySans_700Bold",
        // Figtree, Inter, Nunito (four weights each) and Atkinson Hyperlegible (regular, bold).
        ...["Figtree", "Inter", "Nunito"].flatMap((name) =>
          ["400Regular", "500Medium", "600SemiBold", "700Bold"].map(
            (weight) => `${name}_${weight}`,
          ),
        ),
        "AtkinsonHyperlegible_400Regular",
        "AtkinsonHyperlegible_700Bold",
      ].sort(),
    );
  });

  it("resolves a custom type spec on native", () => {
    expect(fontStyle("bold", latinThenRubik).fontFamily).toBe(
      "SpaceGrotesk_700Bold",
    );
    expect(
      withAppFont({ fontWeight: "700" }, "regular", "text", latinThenRubik)
        .fontFamily,
    ).toBe("SpaceGrotesk_700Bold");
  });

  it("leaves a foreign fontFamily alone", () => {
    expect(withAppFont({ fontFamily: "Courier", fontWeight: "700" })).toEqual({
      fontFamily: "Courier",
      fontWeight: "700",
    });
  });

  it("registers exactly the loaded families", () => {
    expect(isRegisteredFamily("Rubik_400Regular")).toBe(true);
    expect(isRegisteredFamily("SpaceGrotesk_700Bold")).toBe(true);
    expect(isRegisteredFamily("Courier")).toBe(false);
  });

  it("derives font ids and script coverage from the type spec", () => {
    expect(fontIdsForTheme(classicTheme.type)).toEqual(["figtree", "rubik"]);
    expect([...scriptsCovered(classicTheme.type)].sort()).toEqual([
      "hebrew",
      "latin",
    ]);
    expect([
      ...scriptsCovered({
        ...classicTheme.type,
        text: { family: "space-grotesk", fallbacks: [] },
      }),
    ]).toEqual(["latin"]);
  });
});
