import { clampPaletteContrast } from "@/theme/custom/contrast";
import { FULL_EXAMPLE, MINIMAL_EXAMPLE } from "@/theme/custom/examples";
import {
  MAX_CUSTOM_THEME_BYTES,
  canonicalizeCustomThemeFile,
  exportCustomThemeJson,
  parseCustomTheme,
  type CustomThemeFile,
} from "@/theme/custom/schema";
import { FONT_REGISTRY, scriptsCovered } from "@/theme/fonts";
import { shadowBlurs } from "@/theme/shadow";
import { accentTokens } from "@/theme/theme";
import { BUILT_IN_THEMES } from "@/theme/themes/registry";
import { assertThemeDefinition } from "@/theme/themes/validate";
import { contrastRatio, lightTokens, readableTextColor } from "@/theme/tokens";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const errorsOf = (input: unknown) => {
  const result = parseCustomTheme(input);
  if (result.ok) throw new Error("expected the theme to be rejected");
  return result.errors;
};
const themeOf = (input: unknown) => {
  const result = parseCustomTheme(input);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
};

describe("parseCustomTheme: valid files", () => {
  it("accepts the minimal example and inherits Classic", () => {
    const { theme, warnings } = themeOf(MINIMAL_EXAMPLE);
    expect(warnings).toEqual([]);
    expect(theme.id).toBe("forest-minimal");
    expect(theme.palette.light.background).toBe("#EEF3EC");
    expect(theme.palette.light.text).toBe(lightTokens.text);
    expect(theme.material.engine).toBe("soft");
    expect(theme.icons.set).toBe("ionicons");
    expect(theme.availableOn).toBeUndefined();
  });

  it("accepts the full example: bevel, pixelify, pixel icons, charts", () => {
    const { theme, warnings } = themeOf(FULL_EXAMPLE);
    expect(warnings).toEqual([]);
    expect(theme.material).toEqual({
      engine: "bevel",
      gradients: false,
      bevelDepth: 2,
    });
    expect(theme.type.text.family).toBe("pixelify-sans");
    expect(theme.icons.set).toBe("pixel");
    expect(theme.charts.patterns).toBe(true);
    expect(theme.charts.categoryPalette).toHaveLength(8);
    expect(theme.motion.press).toBe("translate");
    expect(theme.motion.duration.base).toBe(Math.round(200 * 0.8));
    for (const scheme of ["light", "dark"] as const) {
      for (const [key, value] of Object.entries(theme.shadows[scheme])) {
        if (key !== "scrim")
          expect(shadowBlurs(value).filter((blur) => blur > 0)).toEqual([]);
      }
    }
  });

  it("never throws on arbitrary input", () => {
    for (const input of [
      null,
      undefined,
      5,
      "x",
      [],
      () => 1,
      { themeSchemaVersion: 1 },
      Object.create(null),
    ]) {
      expect(() => parseCustomTheme(input)).not.toThrow();
      expect(parseCustomTheme(input).ok).toBe(false);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(parseCustomTheme(cyclic).ok).toBe(false);
  });

  it("can extend another built-in and drops the system accent mode", () => {
    const file = { ...clone(MINIMAL_EXAMPLE), extends: "material-you" };
    const { theme } = themeOf(file);
    expect(theme.accent.mode).toBe("user");
    expect(theme.availableOn).toBeUndefined();
  });

  it("re-derives high-contrast rings from the merged palette", () => {
    const file = { ...clone(MINIMAL_EXAMPLE), extends: "high-contrast" };
    const { theme } = themeOf(file);
    expect(theme.shadows.light.shadowRaised).toContain(
      theme.palette.light.text,
    );
  });

  it("switching press style on a base that disables it still moves the control", () => {
    const toTranslate = themeOf({
      ...clone(MINIMAL_EXAMPLE),
      motion: { press: "translate" },
    });
    expect(toTranslate.theme.motion.pressTranslate).toBeGreaterThanOrEqual(1);
  });
});

describe("parseCustomTheme: rejection (fail closed)", () => {
  it("requires both light and dark, non-empty", () => {
    const noDark = clone(MINIMAL_EXAMPLE) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    delete noDark.palette.dark;
    expect(errorsOf(noDark)).toEqual(
      expect.arrayContaining([expect.stringContaining("palette.dark")]),
    );

    const emptyLight = clone(MINIMAL_EXAMPLE);
    emptyLight.palette.light = {};
    expect(errorsOf(emptyLight).join("\n")).toMatch(
      /palette\.light: must define at least one color/,
    );

    const noPalette = clone(MINIMAL_EXAMPLE) as unknown as Record<
      string,
      unknown
    >;
    delete noPalette.palette;
    expect(errorsOf(noPalette).join("\n")).toMatch(/palette/);
  });

  it("rejects unknown top-level and nested keys", () => {
    expect(errorsOf({ ...clone(MINIMAL_EXAMPLE), colour: 1 })).toContain(
      "$.colour: unknown key (allowed: themeSchemaVersion, id, name, extends, palette, accent, shape, material, motion, type, icons, charts)",
    );
    const nested = clone(MINIMAL_EXAMPLE) as unknown as {
      palette: { light: Record<string, string> };
    };
    nested.palette.light.textt = "#000000";
    expect(errorsOf(nested).join("\n")).toMatch(
      /palette\.light\.textt: unknown key/,
    );
    expect(
      errorsOf({
        ...clone(MINIMAL_EXAMPLE),
        material: { engin: "bevel" },
      }).join("\n"),
    ).toMatch(/material\.engin: unknown key/);
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), shadows: {} }).join("\n"),
    ).toMatch(/shadows: unknown key/);
    expect(
      errorsOf(
        JSON.parse('{"__proto__": {"x": 1}, "themeSchemaVersion": 1}'),
      ).join("\n"),
    ).toMatch(/__proto__/);
  });

  it("reports path-addressed errors for bad colors", () => {
    const file = clone(MINIMAL_EXAMPLE);
    (file.palette.dark as Record<string, string>).text = "white";
    expect(errorsOf(file)).toContain(
      "palette.dark.text: must be a #RRGGBB color",
    );
  });

  it("rejects URLs, data URIs, javascript and url() anywhere", () => {
    for (const evil of [
      "https://example.com/x",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "url(foo.png)",
      "//cdn.example.com",
    ]) {
      expect(
        parseCustomTheme({ ...clone(MINIMAL_EXAMPLE), name: evil }).ok,
      ).toBe(false);
    }
    const colorUrl = clone(MINIMAL_EXAMPLE) as unknown as {
      palette: { light: Record<string, string> };
    };
    colorUrl.palette.light.background = "url(https://example.com/a.png)";
    expect(errorsOf(colorUrl).join("\n")).toMatch(/palette\.light\.background/);
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), "url(x)": 1 }).join("\n"),
    ).toMatch(/key must not contain a URL/);
    expect(
      errorsOf({
        ...clone(MINIMAL_EXAMPLE),
        type: { text: { family: "https://x/y.ttf" } },
      }).join("\n"),
    ).toMatch(/type\.text/);
  });

  it("rejects built-in id collisions and bad ids", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(
        errorsOf({ ...clone(MINIMAL_EXAMPLE), id: theme.id }).join("\n"),
      ).toMatch(/built-in theme id/);
    }
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), id: "Not Valid" }).join("\n"),
    ).toMatch(/^id:/m);
  });

  it("validates the name", () => {
    expect(parseCustomTheme({ ...clone(MINIMAL_EXAMPLE), name: "" }).ok).toBe(
      false,
    );
    expect(
      parseCustomTheme({ ...clone(MINIMAL_EXAMPLE), name: "x".repeat(41) }).ok,
    ).toBe(false);
    expect(
      parseCustomTheme({ ...clone(MINIMAL_EXAMPLE), name: "bad\nname" }).ok,
    ).toBe(false);
    expect(
      parseCustomTheme({ ...clone(MINIMAL_EXAMPLE), name: "a‮b" }).ok,
    ).toBe(false);
    expect(
      parseCustomTheme({ ...clone(MINIMAL_EXAMPLE), name: "ערכת נושא" }).ok,
    ).toBe(true);
  });

  it("rejects the wrong schema version", () => {
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), themeSchemaVersion: 2 }),
    ).toContain("themeSchemaVersion: must be 1");
  });

  it("rejects oversized files", () => {
    const big = {
      ...clone(MINIMAL_EXAMPLE),
      charts: {
        categoryPalette: Array.from({ length: 4000 }, () => "#000000"),
      },
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_CUSTOM_THEME_BYTES);
    expect(errorsOf(big).join("\n")).toMatch(/too large/);
  });

  it("rejects out-of-range numbers", () => {
    const cases: [
      Partial<CustomThemeFile> | Record<string, unknown>,
      RegExp,
    ][] = [
      [{ shape: { radius: { card: 65 } } }, /shape\.radius\.card/],
      [{ shape: { radius: { pill: 1000 } } }, /shape\.radius\.pill/],
      [{ shape: { space: { md: 49 } } }, /shape\.space\.md/],
      [{ shape: { space: { md: -1 } } }, /shape\.space\.md/],
      [{ shape: { tile: { size: 31 } } }, /shape\.tile\.size/],
      [{ shape: { tile: { icon: 41 } } }, /shape\.tile\.icon/],
      [{ shape: { tile: { compactSize: 49 } } }, /shape\.tile\.compactSize/],
      [{ shape: { tile: { compactIcon: 11 } } }, /shape\.tile\.compactIcon/],
      [
        { shape: { tile: { size: 32, icon: 40 } } },
        /shape\.tile\.icon: must not be larger/,
      ],
      [{ material: { bevelDepth: 5 } }, /material\.bevelDepth/],
      [{ material: { bevelDepth: 1.5 } }, /material\.bevelDepth/],
      [{ motion: { pressScale: 0.5 } }, /motion\.pressScale/],
      [{ motion: { pressTranslate: 9 } }, /motion\.pressTranslate/],
      [{ motion: { durationScale: 3 } }, /motion\.durationScale/],
      [{ charts: { lineWidth: 0 } }, /charts\.lineWidth/],
      [{ charts: { donutThickness: 40 } }, /charts\.donutThickness/],
      [{ charts: { categoryPalette: ["#000000"] } }, /charts\.categoryPalette/],
      [
        {
          charts: {
            categoryPalette: Array.from({ length: 13 }, () => "#000000"),
          },
        },
        /charts\.categoryPalette/,
      ],
      [{ charts: { gridDash: "a b" } }, /charts\.gridDash/],
      [
        { accent: { presets: Array.from({ length: 13 }, () => "#000000") } },
        /accent\.presets/,
      ],
      [
        { motion: { press: "translate", pressTranslate: 0 } },
        /pressTranslate: must be at least 1/,
      ],
      [
        { motion: { press: "scale", pressScale: 1 } },
        /pressScale: must be below 1/,
      ],
    ];
    for (const [patch, pattern] of cases) {
      expect(
        errorsOf({ ...clone(MINIMAL_EXAMPLE), ...patch }).join("\n"),
      ).toMatch(pattern);
    }
  });

  it("rejects unknown fonts, icon sets and enums", () => {
    expect(
      errorsOf({
        ...clone(MINIMAL_EXAMPLE),
        type: { text: { family: "comic-sans" } },
      }).join("\n"),
    ).toMatch(/type\.text\.family/);
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), icons: { set: "nope" } }).join(
        "\n",
      ),
    ).toMatch(/icons\.set/);
    expect(
      errorsOf({
        ...clone(MINIMAL_EXAMPLE),
        material: { engine: "glass" },
      }).join("\n"),
    ).toMatch(/material\.engine/);
    expect(
      errorsOf({
        ...clone(MINIMAL_EXAMPLE),
        charts: { lineCap: "pointy" },
      }).join("\n"),
    ).toMatch(/charts\.lineCap/);
  });

  it("rejects extending a custom or unknown theme", () => {
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), extends: "moss-block" }).join("\n"),
    ).toMatch(/custom themes cannot extend custom themes/);
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), extends: 5 }).join("\n"),
    ).toMatch(/^extends:/m);
  });

  it("rejects the system accent mode", () => {
    expect(
      errorsOf({ ...clone(MINIMAL_EXAMPLE), accent: { mode: "system" } }).join(
        "\n",
      ),
    ).toMatch(/accent\.mode: "system" is not allowed/);
  });

  it("collects every error, not just the first", () => {
    const errors = errorsOf({
      ...clone(MINIMAL_EXAMPLE),
      icons: { set: "x" },
      material: { engine: "y" },
      extra: 1,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("contrast clamping", () => {
  it("clamps faint text and reports each change", () => {
    const file: CustomThemeFile = {
      ...clone(MINIMAL_EXAMPLE),
      palette: {
        light: { textMuted: "#CCCCCC", warning: "#FFFF00" },
        dark: { text: "#222222", negative: "#111111" },
      },
    };
    const { theme, warnings } = themeOf(file);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    expect(warnings.join("\n")).toMatch(
      /palette\.light\.textMuted changed from #CCCCCC to #[0-9A-F]{6} to keep 4\.5:1 contrast against surface/,
    );
    for (const scheme of ["light", "dark"] as const) {
      const p = theme.palette[scheme];
      expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.text, p.surfaceElevated)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
      for (const key of ["positive", "negative", "warning"] as const) {
        expect(contrastRatio(p[key], p.surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the author file untouched by clamping", () => {
    const file: CustomThemeFile = {
      ...clone(MINIMAL_EXAMPLE),
      palette: {
        light: { textMuted: "#CCCCCC" },
        dark: { background: "#000000" },
      },
    };
    const result = themeOf(file);
    expect(result.file.palette.light.textMuted).toBe("#CCCCCC");
    expect(result.theme.palette.light.textMuted).not.toBe("#CCCCCC");
  });

  it("is pure and leaves a conforming palette alone", () => {
    const first = clampPaletteContrast("light", lightTokens);
    expect(first.warnings).toEqual([]);
    expect(first.palette).toEqual(lightTokens);
    expect(
      clampPaletteContrast("light", { ...lightTokens, textMuted: "#DDDDDD" }),
    ).toEqual(
      clampPaletteContrast("light", { ...lightTokens, textMuted: "#DDDDDD" }),
    );
  });

  it("rejects a palette no single text color can satisfy", () => {
    const file: CustomThemeFile = {
      ...clone(MINIMAL_EXAMPLE),
      palette: {
        light: {
          surface: "#FFFFFF",
          background: "#808080",
          surfaceElevated: "#000000",
        },
        dark: { background: "#000000" },
      },
    };
    expect(errorsOf(file).join("\n")).toMatch(/cannot reach 4\.5:1/);
  });

  it("relies on accentTokens to clamp the accent at render time", () => {
    const { theme } = themeOf({
      ...clone(MINIMAL_EXAMPLE),
      accent: { mode: "fixed", default: "#FFFF00" },
    });
    for (const dark of [false, true]) {
      const tokens = accentTokens(theme.accent.default, dark, theme);
      expect(
        contrastRatio(tokens.staticAccent, tokens.staticSurface),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(tokens.onAccent as string, tokens.staticAccent),
      ).toBeGreaterThanOrEqual(4.5);
      expect(tokens.onAccent).toBe(readableTextColor(tokens.staticAccent));
    }
  });
});

describe("derived typography", () => {
  it("gives every non-Rubik face a Rubik fallback so Hebrew always has glyphs", () => {
    for (const family of Object.keys(FONT_REGISTRY)) {
      const { theme } = themeOf({
        ...clone(MINIMAL_EXAMPLE),
        type: { text: { family }, numeric: { family } },
      });
      expect(theme.type.text.fallbacks).toEqual(
        family === "rubik" ? [] : ["rubik"],
      );
      expect(scriptsCovered(theme.type).has("hebrew")).toBe(true);
      expect(scriptsCovered(theme.type).has("latin")).toBe(true);
    }
  });
});

describe("conformance with built-ins", () => {
  it.each([
    ["minimal", MINIMAL_EXAMPLE],
    ["full", FULL_EXAMPLE],
  ] as const)(
    "%s example passes the same rules as built-ins",
    (_name, example) => {
      const { theme } = themeOf(example);
      expect(() => assertThemeDefinition(theme)).not.toThrow();
      for (const scheme of ["light", "dark"] as const) {
        const p = theme.palette[scheme];
        expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.textMuted, p.surface)).toBeGreaterThanOrEqual(
          4.5,
        );
        const tokens = accentTokens(
          theme.accent.default,
          scheme === "dark",
          theme,
        );
        expect(
          contrastRatio(
            readableTextColor(tokens.staticAccent),
            tokens.staticAccent,
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(theme.tile.size).toBeGreaterThanOrEqual(32);
      if (theme.motion.press === "translate")
        expect(theme.motion.pressTranslate).toBeGreaterThanOrEqual(1);
      else expect(theme.motion.pressScale).toBeLessThan(1);
      expect(BUILT_IN_THEMES.map((builtIn) => builtIn.id)).not.toContain(
        theme.id,
      );
    },
  );
});

describe("export and round trip", () => {
  it("exports 2-space JSON with a stable key order that re-parses to the same file", () => {
    const scrambled = {
      charts: { lineCap: "butt", patterns: true },
      palette: {
        dark: { text: "#FFFFFF", background: "#000000" },
        light: { surface: "#FFFFFF", background: "#EEEEEE" },
      },
      name: "Scrambled",
      id: "scrambled",
      themeSchemaVersion: 1,
      extends: "classic",
    };
    const result = themeOf(scrambled);
    const json = exportCustomThemeJson(result.file);
    expect(
      json.startsWith(
        '{\n  "themeSchemaVersion": 1,\n  "id": "scrambled",\n  "name": "Scrambled",\n  "extends": "classic",\n  "palette": {',
      ),
    ).toBe(true);
    expect(json).toContain(
      '"light": {\n      "background": "#EEEEEE",\n      "surface": "#FFFFFF"',
    );
    expect(Object.keys(JSON.parse(json))).toEqual([
      "themeSchemaVersion",
      "id",
      "name",
      "extends",
      "palette",
      "charts",
    ]);
    const again = themeOf(JSON.parse(json));
    expect(again.file).toEqual(result.file);
    expect(exportCustomThemeJson(again.file)).toBe(json);
  });

  it("round-trips both examples exactly", () => {
    for (const example of [MINIMAL_EXAMPLE, FULL_EXAMPLE]) {
      const { file } = themeOf(example);
      expect(file).toEqual(example);
      expect(canonicalizeCustomThemeFile(file)).toEqual(example);
      expect(themeOf(JSON.parse(exportCustomThemeJson(file))).file).toEqual(
        example,
      );
    }
  });
});
