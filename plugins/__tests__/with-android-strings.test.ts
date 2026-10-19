import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { XML } from "expo/config-plugins";

import withAndroidStrings, {
  buildStringElement,
  buildStringsXml,
  escapeAndroidString,
  mergeStringsXml,
  parseCatalog,
  resourcesFor,
  type StringsCatalog,
} from "../with-android-strings";

const FIXTURE: StringsCatalog = {
  version: 1,
  strings: [
    { name: "q_0123456789abcdef", en: "Save", he: "שמור" },
    {
      name: "q_1123456789abcdef",
      en: "Tom & Jerry <b>",
      he: "תום ו\u2019ג׳רי",
    },
    { name: "q_2123456789abcdef", en: "100% sure", he: "100% בטוח" },
    { name: "q_3123456789abcdef", en: 'Don\'t "quote"', he: "אל תצטט" },
  ],
  patterns: [
    {
      name: "q_4123456789abcdef",
      source: "^(\\d+) of (\\d+)$",
      en: "%1$s of %2$s (100%%)",
      he: "%1$s מתוך %2$s (100%%)",
    },
  ],
};

/** What aapt2 makes of a string body: surrounding quotes dropped, backslash escapes decoded. */
function decodeAndroid(xmlText: string): string {
  const text = xmlText
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const unquoted =
    /^"[\s\S]*"$/.test(text) && !/^"\\"$/.test(text) ? text.slice(1, -1) : text;
  return unquoted.replace(/\\(.)/g, (_, ch: string) =>
    ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch,
  );
}

describe("escapeAndroidString", () => {
  it.each([
    ["plain", "Save", "Save"],
    ["ampersand", "Tom & Jerry", "Tom &amp; Jerry"],
    ["angle brackets", "<b>1 > 0</b>", "&lt;b&gt;1 &gt; 0&lt;/b&gt;"],
    ["apostrophe", "Don't", "Don\\'t"],
    ["double quote", 'Say "hi"', 'Say \\"hi\\"'],
    ["leading at", "@home", "\\@home"],
    ["leading question mark", "?attr", "\\?attr"],
    ["inner at and question mark", "a@b? c", "a@b? c"],
    ["newline", "one\ntwo", "one\\ntwo"],
    ["backslash", "C:\\dir", "C:\\\\dir"],
    ["lone percent", "50% off", "50% off"],
    ["Hebrew", "שלום עולם", "שלום עולם"],
    ["right single quote U+2019", "Don\u2019t", "Don\u2019t"],
    ["leading space", " pad", '" pad"'],
    ["trailing space", "pad ", '"pad "'],
    ["double space inside", "a  b", '"a  b"'],
    ["escaped tab is not a run", "a\t b", "a\\t b"],
    ["single spaces stay unquoted", "a b c", "a b c"],
    ["quoted whitespace keeps escapes", ' say "x"', '" say \\"x\\""'],
  ])("%s", (_label, raw, expected) => {
    expect(escapeAndroidString(raw)).toBe(expected);
  });

  it("round-trips through aapt-style decoding", () => {
    for (const raw of [
      "Tom & Jerry <b>",
      'Don\'t "quote" \\ 50%',
      "line1\nline2",
      "  padded  ",
      "@x",
      "?y",
      "שלום \u2019 %1$s %%",
    ]) {
      expect(decodeAndroid(escapeAndroidString(raw))).toBe(raw);
    }
  });

  it("agrees with the strings mod's own escaping, which writes the English file", () => {
    for (const raw of [
      "Tom & Jerry <b>",
      'Don\'t "quote" \\ 50%',
      "a\nb",
      " lead",
      "trail ",
      "@x",
      "mid @ and ? stay readable",
      "שלום \u2019",
    ]) {
      const written = XML.format({
        resources: { string: [{ $: { name: "q_x" }, _: raw }] },
      });
      const body =
        /<string name="q_x">([\s\S]*)<\/string>/.exec(written)?.[1] ?? "";
      expect(decodeAndroid(body)).toBe(raw);
      expect(decodeAndroid(escapeAndroidString(raw))).toBe(raw);
    }
  });
});

describe("buildStringsXml", () => {
  it("builds the Hebrew catalog with formatted=false on every entry and nothing untranslatable", () => {
    const xml = buildStringsXml(resourcesFor(FIXTURE, "he"));
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<resources>",
        '  <string name="q_0123456789abcdef" formatted="false">שמור</string>',
        '  <string name="q_1123456789abcdef" formatted="false">תום ו\u2019ג׳רי</string>',
        '  <string name="q_2123456789abcdef" formatted="false">100% בטוח</string>',
        '  <string name="q_3123456789abcdef" formatted="false">אל תצטט</string>',
        '  <string name="q_4123456789abcdef" formatted="false">%1$s מתוך %2$s (100%%)</string>',
        "</resources>",
        "",
      ].join("\n"),
    );
    expect(xml).not.toContain("translatable");
  });

  it("escapes English values and keeps pattern placeholders as written", () => {
    const xml = buildStringsXml(resourcesFor(FIXTURE, "en"));
    expect(xml).toContain(
      '<string name="q_1123456789abcdef" formatted="false">Tom &amp; Jerry &lt;b&gt;</string>',
    );
    expect(xml).toContain(
      '<string name="q_3123456789abcdef" formatted="false">Don\\\'t \\"quote\\"</string>',
    );
    expect(xml).toContain(
      '<string name="q_4123456789abcdef" formatted="false">%1$s of %2$s (100%%)</string>',
    );
  });

  it("builds a single element", () => {
    expect(buildStringElement({ name: "q_a", value: "x" })).toBe(
      '<string name="q_a" formatted="false">x</string>',
    );
  });
});

describe("mergeStringsXml", () => {
  const existing = [
    '<resources xmlns:tools="http://schemas.android.com/tools">',
    '  <string name="app_name">Qashy</string>',
    '  <string name="share_into_scheme">qashy</string>',
    '  <string name="q_0123456789abcdef" formatted="false">stale</string>',
    '  <color name="splash">#ffffff</color>',
    "</resources>",
  ].join("\n");

  it("creates a file when none exists", () => {
    expect(mergeStringsXml(null, [{ name: "q_a", value: "x" }])).toBe(
      buildStringsXml([{ name: "q_a", value: "x" }]),
    );
    expect(mergeStringsXml("  \n", [{ name: "q_a", value: "x" }])).toBe(
      buildStringsXml([{ name: "q_a", value: "x" }]),
    );
  });

  it("keeps app_name and other resources, replaces same-named entries, adds the rest", () => {
    const merged = mergeStringsXml(existing, resourcesFor(FIXTURE, "en"));
    expect(merged).toContain(
      '<resources xmlns:tools="http://schemas.android.com/tools">',
    );
    expect(merged).toContain('<string name="app_name">Qashy</string>');
    expect(merged).toContain('<string name="share_into_scheme">qashy</string>');
    expect(merged).toContain('<color name="splash">#ffffff</color>');
    expect(merged).not.toContain("stale");
    expect(merged.match(/name="q_0123456789abcdef"/g)).toHaveLength(1);
    expect(merged.match(/<string name="q_/g)).toHaveLength(5);
    expect(merged.trimEnd().endsWith("</resources>")).toBe(true);
  });

  it("is idempotent", () => {
    const once = mergeStringsXml(existing, resourcesFor(FIXTURE, "he"));
    expect(mergeStringsXml(once, resourcesFor(FIXTURE, "he"))).toBe(once);
  });

  it("does not touch string-array elements or longer names", () => {
    const xml = [
      "<resources>",
      '  <string-array name="q_a"><item>1</item></string-array>',
      '  <string name="q_ab">keep</string>',
      "</resources>",
    ].join("\n");
    const merged = mergeStringsXml(xml, [{ name: "q_a", value: "new" }]);
    expect(merged).toContain(
      '<string-array name="q_a"><item>1</item></string-array>',
    );
    expect(merged).toContain('<string name="q_ab">keep</string>');
    expect(merged).toContain(
      '<string name="q_a" formatted="false">new</string>',
    );
  });

  it("quotes a value with a run of spaces in the strings it builds", () => {
    expect(buildStringElement({ name: "q_a", value: "x  y" })).toBe(
      '<string name="q_a" formatted="false">"x  y"</string>',
    );
  });

  it("replaces a library-written, unquoted run of spaces with the quoted form", () => {
    const libraryOutput = [
      "<resources>",
      '  <string name="q_a" formatted="false">x  y</string>',
      "</resources>",
    ].join("\n");
    const fixed = mergeStringsXml(libraryOutput, [
      { name: "q_a", value: "x  y" },
    ]);
    expect(fixed).toContain(
      '<string name="q_a" formatted="false">"x  y"</string>',
    );
    expect(fixed.match(/name="q_a"/g)).toHaveLength(1);
  });

  it("rejects a file without a closing resources tag", () => {
    expect(() =>
      mergeStringsXml("<resources/>", [{ name: "q_a", value: "x" }]),
    ).toThrow();
  });
});

describe("parseCatalog", () => {
  it("accepts the fixture", () => {
    expect(parseCatalog(JSON.stringify(FIXTURE))).toEqual(FIXTURE);
  });

  it.each([
    ["wrong version", { ...FIXTURE, version: 2 }],
    ["missing patterns", { version: 1, strings: [] }],
    [
      "non-string value",
      { ...FIXTURE, strings: [{ name: "q_a", en: 1, he: "x" }] },
    ],
    [
      "bad name",
      { ...FIXTURE, strings: [{ name: "Not Valid", en: "a", he: "b" }] },
    ],
    [
      "duplicate name",
      {
        ...FIXTURE,
        strings: [
          { name: "q_a", en: "a", he: "b" },
          { name: "q_a", en: "c", he: "d" },
        ],
      },
    ],
    [
      "pattern without source",
      { ...FIXTURE, patterns: [{ name: "q_p", en: "a", he: "b" }] },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseCatalog(JSON.stringify(value))).toThrow();
  });
});

describe("replacement-pattern characters in values", () => {
  const values = ["a$'b", "a$&b", "cost $$5", "$1 and $` end", "$'$&$$$1"];

  it("writes them literally when merging into an existing file", () => {
    const items = values.map((value, i) => ({ name: `q_${i}`, value }));
    const merged = mergeStringsXml(
      '<resources>\n  <string name="app_name">Qashy</string>\n</resources>',
      items,
    );
    for (const { name, value } of items) {
      expect(merged).toContain(buildStringElement({ name, value }));
    }
    // The apostrophe is escaped for Android; the `$` text around it is untouched.
    expect(merged).toContain(">a$\\'b</string>");
    expect(merged).toContain(">cost $$5</string>");
    expect(merged).toContain(">$1 and $` end</string>");
    expect(merged).toContain('<string name="app_name">Qashy</string>');
  });
});

describe("pruning stale generated entries", () => {
  const existing = [
    "<resources>",
    '  <string name="app_name">Qashy</string>',
    '  <string name="q_keep" formatted="false">old</string>',
    '  <string name="q_gone" formatted="false">removed from the catalog</string>',
    '  <string name="quick_other">not ours</string>',
    "</resources>",
  ].join("\n");

  it("drops q_ entries missing from the catalog and never touches others", () => {
    const merged = mergeStringsXml(
      existing,
      [{ name: "q_keep", value: "new" }],
      {
        pruneStale: true,
      },
    );
    expect(merged).not.toContain("q_gone");
    expect(merged).toContain('<string name="app_name">Qashy</string>');
    expect(merged).toContain('<string name="quick_other">not ours</string>');
    expect(merged).toContain(
      '<string name="q_keep" formatted="false">new</string>',
    );
    expect(merged.match(/q_keep/g)).toHaveLength(1);
  });

  it("keeps stale entries when pruning is off", () => {
    expect(
      mergeStringsXml(existing, [{ name: "q_keep", value: "new" }]),
    ).toContain("q_gone");
  });
});

describe("the config plugin's mods", () => {
  const catalog: StringsCatalog = {
    version: 1,
    strings: [
      { name: "q_aaaaaaaaaaaaaaaa", en: "a  b", he: "א  ב" },
      { name: "q_bbbbbbbbbbbbbbbb", en: " lead", he: " הוביל" },
      { name: "q_cccccccccccccccc", en: "plain", he: "פשוט" },
    ],
    patterns: [],
  };
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "qashy-strings-"));
    fs.mkdirSync(path.join(root, "android/app/src/main/res/values"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(root, "android/app/src/main/res/values-iw"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, "catalog.json"), JSON.stringify(catalog));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  type Mod = (cfg: Record<string, unknown>) => Promise<Record<string, unknown>>;
  function mods(): Record<"strings" | "finalized" | "dangerous", Mod> {
    const config = withAndroidStrings(
      { name: "t", slug: "t" },
      { catalogPath: "catalog.json" },
    );
    return (config as unknown as { mods: { android: Record<string, Mod> } })
      .mods.android as Record<"strings" | "finalized" | "dangerous", Mod>;
  }
  const modRequest = () => ({
    projectRoot: root,
    platformProjectRoot: path.join(root, "android"),
    platform: "android",
  });
  const valuesFile = () =>
    path.join(root, "android/app/src/main/res/values/strings.xml");
  const hebrewFile = () =>
    path.join(root, "android/app/src/main/res/values-iw/strings.xml");

  it("English: keeps app_name, drops stale q_ entries, and quotes whitespace-sensitive text", async () => {
    const { strings, finalized } = mods();
    const result = await strings({
      modRequest: modRequest(),
      modResults: {
        resources: {
          string: [
            { $: { name: "app_name" }, _: "Qashy" },
            { $: { name: "q_stale0000000000" }, _: "stale" },
          ],
        },
      },
    });
    // The base mod would write this; the finalized mod then fixes up the written file.
    fs.writeFileSync(valuesFile(), XML.format(result.modResults));
    await finalized({ modRequest: modRequest() });
    const xml = fs.readFileSync(valuesFile(), "utf8");
    expect(xml).toContain('<string name="app_name">Qashy</string>');
    expect(xml).not.toContain("q_stale0000000000");
    expect(xml).toContain(
      '<string name="q_aaaaaaaaaaaaaaaa" formatted="false">"a  b"</string>',
    );
    expect(xml).toContain(
      '<string name="q_bbbbbbbbbbbbbbbb" formatted="false">" lead"</string>',
    );
    expect(xml).toContain(
      '<string name="q_cccccccccccccccc" formatted="false">plain</string>',
    );
    expect(xml.match(/name="q_/g)).toHaveLength(3);
  });

  it("Hebrew: creates the file, then merges and prunes on the next run", async () => {
    const { dangerous } = mods();
    await dangerous({ modRequest: modRequest() });
    const first = fs.readFileSync(hebrewFile(), "utf8");
    expect(first).toContain('formatted="false">"א  ב"</string>');
    expect(first).toContain('formatted="false">" הוביל"</string>');

    fs.writeFileSync(
      hebrewFile(),
      first.replace(
        "</resources>",
        '  <string name="q_stale0000000000" formatted="false">ישן</string>\n  <string name="app_name">x</string>\n</resources>',
      ),
    );
    await dangerous({ modRequest: modRequest() });
    const second = fs.readFileSync(hebrewFile(), "utf8");
    expect(second).not.toContain("q_stale0000000000");
    expect(second).toContain('<string name="app_name">x</string>');
    expect(second.match(/name="q_/g)).toHaveLength(3);
  });
});
