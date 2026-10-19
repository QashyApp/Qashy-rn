import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildAndroidCatalog,
  groupCount,
  sampleArguments,
} from "@/localization/android-catalog";
import { translateMessage } from "@/localization/localization";
import { createDynamicPatterns, HEBREW } from "@/localization/messages/he";
import {
  translateWithTable,
  type NativeTable,
} from "@/localization/native-table";
import {
  formatResource,
  patternFormat,
  resourceName,
} from "@/localization/resource-names";

/** Independent FNV-1a 64 over TextEncoder bytes, to cross-check `resourceName`. */
function referenceName(text: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `q_${hash.toString(16).padStart(16, "0")}`;
}

/** The Hebrew table with nested translation off, the one the catalog is built from. */
const hebrewPatterns = createDynamicPatterns((message) => message);
const firstHebrewMatch = (message: string) =>
  hebrewPatterns.find(([regex]) => regex.test(message));

/** English messages a pattern matches, from the catalog's own sample arguments. */
function sampleMessages(en: string, source: string) {
  const regex = new RegExp(source);
  return sampleArguments(regex, groupCount(en))
    .map((args) => formatResource(en, args))
    .filter((message) => regex.test(message));
}

describe("android string catalog", () => {
  const { catalog, runtime } = buildAndroidCatalog();

  it("is up to date with the Hebrew message tables", () => {
    const committed: unknown = JSON.parse(
      readFileSync(join(__dirname, "..", "android-strings.json"), "utf8"),
    );
    if (JSON.stringify(committed) !== JSON.stringify(catalog)) {
      throw new Error(
        "src/localization/android-strings.json is out of date. Run `npm run strings:android` and commit the result.",
      );
    }
  });

  it("has an up-to-date slim runtime list", () => {
    const committed: unknown = JSON.parse(
      readFileSync(join(__dirname, "..", "android-runtime.json"), "utf8"),
    );
    if (JSON.stringify(committed) !== JSON.stringify(runtime)) {
      throw new Error(
        "src/localization/android-runtime.json is out of date. Run `npm run strings:android` and commit the result.",
      );
    }
  });

  it("precomputes one resource name per Hebrew key, in key order", () => {
    expect(runtime.strings).toEqual(Object.keys(HEBREW).map(resourceName));
  });

  it("lists every dynamic pattern in the Hebrew table's own order", () => {
    expect(runtime.patterns.map((entry) => entry.source)).toEqual(
      hebrewPatterns.map(([regex]) => regex.source),
    );
    // The named ones are the catalog's patterns, in the same order.
    expect(
      runtime.patterns.flatMap((entry) => (entry.name ? [entry.name] : [])),
    ).toEqual(catalog.patterns.map((entry) => entry.name));
    expect(runtime.patterns.some((entry) => entry.name === null)).toBe(true);
  });

  it("has a unique name for every string and pattern", () => {
    const names = [...catalog.strings, ...catalog.patterns].map(
      (entry) => entry.name,
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("holds one string per Hebrew dictionary entry, sorted by name", () => {
    expect(catalog.strings).toHaveLength(Object.keys(HEBREW).length);
    const names = catalog.strings.map((entry) => entry.name);
    expect(names).toEqual([...names].sort());
    expect(catalog.strings[0]).toEqual({
      name: resourceName(catalog.strings[0].en),
      en: catalog.strings[0].en,
      he: HEBREW[catalog.strings[0].en],
    });
  });

  it("refuses a Hebrew key with outer whitespace", () => {
    expect(() => buildAndroidCatalog({ " Padded": "x" }, () => [])).toThrow(
      /whitespace/,
    );
    expect(() => buildAndroidCatalog({ "Padded ": "x" }, () => [])).toThrow(
      /whitespace/,
    );
  });

  it("refuses a pattern with flags", () => {
    expect(() =>
      buildAndroidCatalog({}, () => [[/^a (\d+)$/i, (n) => `b ${n}`]]),
    ).toThrow(/flags/);
  });

  it("includes a pattern whose capture is an alternation of literals", () => {
    const { catalog: built } = buildAndroidCatalog({}, () => [
      [/^Skipped (\d+) unreadable (row|rows)$/, (count) => `דולגו ${count}`],
    ]);
    expect(built.patterns.map((pattern) => pattern.en)).toEqual([
      "Skipped %1$s unreadable %2$s",
    ]);
    expect(built.patterns[0].he).toBe("דולגו %1$s");
  });

  it("still skips an alternation whose output depends on the alternative", () => {
    const { catalog: built, skipped } = buildAndroidCatalog({}, () => [
      [/^Every (day|week)$/, (unit) => (unit === "day" ? "יום" : "שבוע")],
    ]);
    expect(built.patterns).toHaveLength(0);
    expect(skipped[0]?.reason).toMatch(/pure template/);
  });

  it("translates 1 transaction without a capture, and leaves other counts English", () => {
    expect(translateMessage("1 transaction", "he")).toBe("תנועה אחת");
    expect(translateMessage("5 transactions", "he")).toBe("5 תנועות");
    expect(translateMessage("2 transaction", "he")).toBe("2 transaction");
    expect(catalog.patterns.find((p) => p.en === "1 transaction")?.he).toBe(
      "תנועה אחת",
    );
  });

  it("only includes patterns that round-trip", () => {
    expect(catalog.patterns.length).toBeGreaterThan(0);
    for (const pattern of catalog.patterns) {
      const regex = new RegExp(pattern.source);
      expect(patternFormat(regex)).toBe(pattern.en);
    }
  });

  it("gives every pattern the Hebrew output, not just the English template", () => {
    for (const pattern of catalog.patterns) {
      const replacement = hebrewPatterns.find(
        ([regex]) => regex.source === pattern.source,
      )?.[1];
      expect(replacement).toBeDefined();
      const regex = new RegExp(pattern.source);
      let checked = 0;
      for (const message of sampleMessages(pattern.en, pattern.source)) {
        const captures = regex.exec(message)?.slice(1) ?? [];
        expect(formatResource(pattern.he, captures)).toBe(
          replacement?.(...captures),
        );
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  describe("pattern order at runtime", () => {
    // Play "translates" into Hebrew, so the native path must agree with the Hebrew path.
    const table: NativeTable = {
      strings: new Map(catalog.strings.map((entry) => [entry.en, entry.he])),
      patterns: runtime.patterns.map(({ name, source }) => ({
        regex: new RegExp(source),
        template: catalog.patterns.find((p) => p.name === name)?.he ?? null,
      })),
    };

    const messages = [
      "Delete 3 transactions?",
      "Delete 3 recurring transactions?",
      "Delete Rainy day fund?",
      "Delete the EUR → ILS rate?",
      "Edit (12)",
      "Edit (Rent)",
      ...catalog.patterns.flatMap((pattern) =>
        sampleMessages(pattern.en, pattern.source),
      ),
    ];

    it("picks the same pattern as the Hebrew path for overlapping messages", () => {
      for (const message of messages) {
        const first = firstHebrewMatch(message);
        const included = catalog.patterns.some(
          (pattern) => pattern.source === first?.[0].source,
        );
        const expected =
          !Object.hasOwn(HEBREW, message) && first && !included
            ? message // the Hebrew pattern has no template, so it stays English
            : translateMessage(message, "he");
        expect([message, translateWithTable(message, table)]).toEqual([
          message,
          expected,
        ]);
      }
    });

    it("keeps the patterns without a resource, so they still claim their messages", () => {
      // A pattern with no template claims a message before a later pattern that could translate
      // it, exactly as in the Hebrew table; the message then stays English.
      const claim: NativeTable = {
        strings: new Map(),
        patterns: [
          { regex: /^Edit \((.+)\)$/, template: null },
          { regex: /^Edit \((\d+)\)$/, template: "עריכה (%1$s)" },
        ],
      };
      expect(translateWithTable("Edit (12)", claim)).toBe("Edit (12)");
      // Dropping the nameless entries would let the later, narrower pattern translate it.
      const dropped: NativeTable = {
        ...claim,
        patterns: claim.patterns.filter((entry) => entry.template !== null),
      };
      expect(translateWithTable("Edit (12)", dropped)).toBe("עריכה (12)");
      // The real runtime list keeps its nameless entries, in the Hebrew table's own order.
      expect(runtime.patterns.some((entry) => entry.name === null)).toBe(true);
      expect(runtime.patterns).toHaveLength(hebrewPatterns.length);
    });
  });
});

describe("resourceName", () => {
  it("matches the FNV-1a 64-bit reference vectors", () => {
    expect(resourceName("")).toBe("q_cbf29ce484222325");
    expect(resourceName("a")).toBe("q_af63dc4c8601ec8c");
  });

  it("hashes the UTF-8 bytes of non-ASCII and astral text", () => {
    for (const text of ["שלום", "Overview", "💸 Cash", "é"]) {
      expect(resourceName(text)).toBe(referenceName(text));
      expect(resourceName(text)).toMatch(/^q_[0-9a-f]{16}$/);
    }
  });
});

describe("patternFormat", () => {
  it("converts literal text and capture groups", () => {
    expect(patternFormat(/^Edit (\d+) transactions$/)).toBe(
      "Edit %1$s transactions",
    );
    expect(patternFormat(/^Step (\d+) of (\d+)$/)).toBe("Step %1$s of %2$s");
    expect(patternFormat(/^Done$/)).toBe("Done");
  });

  it("unescapes regex escapes and doubles literal percent signs", () => {
    expect(patternFormat(/^Edit \((\d+)\)$/)).toBe("Edit (%1$s)");
    expect(patternFormat(/^Delete (.+)\?$/)).toBe("Delete %1$s?");
    expect(patternFormat(/^\+(\d+) more\.$/)).toBe("+%1$s more.");
    expect(patternFormat(/^(\d+)% remains$/)).toBe("%1$s%% remains");
  });

  it("rejects anything beyond literals and plain capture groups", () => {
    expect(patternFormat(/Edit (\d+)/)).toBeNull();
    expect(patternFormat(/^Edit (\d+)/)).toBeNull();
    expect(patternFormat(/^Edit (\d+)$/i)).toBeNull();
    expect(patternFormat(/^a|b$/)).toBeNull();
    expect(patternFormat(/^(a|b)?$/)).toBeNull();
    expect(patternFormat(/^colou?r (\d+)$/)).toBeNull();
    expect(patternFormat(/^(\d+) items*$/)).toBeNull();
    expect(patternFormat(/^[abc] (\d+)$/)).toBeNull();
    expect(patternFormat(/^a.b (\d+)$/)).toBeNull();
    expect(patternFormat(/^\d+ items$/)).toBeNull();
    expect(patternFormat(/^(?:a) (\d+)$/)).toBeNull();
    expect(patternFormat(/^(?=a)a (\d+)$/)).toBeNull();
    expect(patternFormat(new RegExp("^(?<n>\\d+)$"))).toBeNull();
    expect(patternFormat(/^((\d+)) x$/)).toBeNull();
    expect(patternFormat(/^(\d+)? x$/)).toBeNull();
  });
});

describe("formatResource", () => {
  it("substitutes positional arguments in any order", () => {
    expect(formatResource("%1$s of %2$s", ["3", "9"])).toBe("3 of 9");
    expect(formatResource("%2$s of %1$s", ["3", "9"])).toBe("9 of 3");
    expect(formatResource("%1$s and %1$s", ["x"])).toBe("x and x");
  });

  it("turns %% into a literal percent sign", () => {
    expect(formatResource("%1$s%% done", ["50"])).toBe("50% done");
    expect(formatResource("100%%", [])).toBe("100%");
    expect(formatResource("%%1$s", ["x"])).toBe("%1$s");
  });

  it("does not re-expand substituted arguments", () => {
    expect(formatResource("%1$s %2$s", ["%2$s", "b"])).toBe("%2$s b");
  });
});
