import * as fs from "node:fs";
import * as path from "node:path";

import {
  AndroidConfig,
  withDangerousMod,
  withFinalizedMod,
  withStringsXml,
  type ConfigPlugin,
} from "expo/config-plugins";

/**
 * Ships the app's UI strings as Android string resources, so Google Play's app-string
 * translation (which reads `values/strings.xml` from the bundle) can translate them, and so the
 * app can read the translations back at runtime (`getStrings` in `modules/qashy-locale`).
 *
 * The catalog is `src/localization/android-strings.json`. This file is loaded by the Expo config
 * loader, which does NOT transpile files it imports, so it must stay self-contained: it reads
 * the JSON with `fs` and imports nothing from `src/`.
 *
 * Every entry is written `formatted="false"` and nothing is `translatable="false"`. Static
 * strings keep a single `%` literal; pattern entries keep their `%1$s` / `%%` text exactly
 * as written, because the app substitutes them in JS from the raw `getString()` text.
 */

export type StringEntry = { name: string; en: string; he: string };
export type PatternEntry = StringEntry & { source: string };
export type StringsCatalog = {
  version: number;
  strings: StringEntry[];
  patterns: PatternEntry[];
};
/** One resource to write: the name and its raw (unescaped) text. */
export type ResourceString = { name: string; value: string };

export const DEFAULT_CATALOG_PATH = "src/localization/android-strings.json";
/** Hebrew's legacy resource qualifier. Android resolves both `he` and `iw` to it. */
export const HEBREW_RES_DIR = "values-iw";

/** Every resource this plugin owns is named with this prefix; nothing else is ever pruned. */
export const GENERATED_PREFIX = "q_";
const STRING_ELEMENT_START = "[ \\t]*<string(?=[\\s/>])";
const STRING_ELEMENT_END = "[^>]*?(?:/>|>[\\s\\S]*?</string>)[ \\t]*\\r?\\n?";

/** Escapes raw text for a `<string>` body that aapt2 will parse as Android string syntax. */
export function escapeAndroidString(value: string): string {
  const escaped = escapeXml(value).replace(/[\\'"\n\r\t]/g, (ch) => {
    switch (ch) {
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default:
        return `\\${ch}`;
    }
  });
  // A leading @ or ? would be read as a resource or theme-attribute reference.
  const guarded = escaped.replace(/^[@?]/, (ch) => `\\${ch}`);
  // aapt2 trims unquoted leading/trailing whitespace and collapses runs of spaces; quotes
  // preserve both.
  return /^\s|\s$|\s{2,}/.test(guarded) ? `"${guarded}"` : guarded;
}

/** Escapes the three characters XML text cannot hold literally. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One `<string>` element, escaped, with `formatted="false"`. */
export function buildStringElement({ name, value }: ResourceString): string {
  return `<string name="${name}" formatted="false">${escapeAndroidString(value)}</string>`;
}

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';

/** A complete strings.xml for `items`. */
export function buildStringsXml(items: readonly ResourceString[]): string {
  const body = items.map((item) => `  ${buildStringElement(item)}`);
  return [XML_HEADER, "<resources>", ...body, "</resources>", ""].join("\n");
}

/**
 * Merges `items` into an existing strings.xml text (or creates one when `existing` is null or
 * blank). Entries with the same name are replaced; everything else, such as `app_name`, comments
 * and other resource types, is left byte for byte as it was.
 */
export function mergeStringsXml(
  existing: string | null,
  items: readonly ResourceString[],
  { pruneStale = false }: { pruneStale?: boolean } = {},
): string {
  if (existing == null || existing.trim() === "") return buildStringsXml(items);
  if (!/<\/resources>/.test(existing)) {
    throw new Error("strings.xml has no closing </resources> tag.");
  }
  let xml = existing;
  if (pruneStale) {
    // Entries this plugin wrote on an earlier, non-clean prebuild and the catalog no longer has.
    const keep = new Set(items.map((item) => item.name));
    xml = xml.replace(
      new RegExp(
        `${STRING_ELEMENT_START}[^>]*?\\bname="(${GENERATED_PREFIX}[^"]*)"${STRING_ELEMENT_END}`,
        "g",
      ),
      (element: string, name: string) => (keep.has(name) ? element : ""),
    );
  }
  for (const { name } of items) {
    const quoted = escapeRegExp(name);
    const element = new RegExp(
      `${STRING_ELEMENT_START}[^>]*\\bname="${quoted}"${STRING_ELEMENT_END}`,
      "g",
    );
    xml = xml.replace(element, "");
  }
  const added = items
    .map((item) => `    ${buildStringElement(item)}\n`)
    .join("");
  // `<resources/>` has no closing tag to insert before; the check above rules that out.
  // A function replacement: a string one would interpret `$'`, `$&` and `$$` in the text.
  return xml.replace(/[ \t]*<\/resources>/, () => `${added}</resources>`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
}

/** Every static string and pattern in one flat list, English or Hebrew. */
export function resourcesFor(
  catalog: StringsCatalog,
  language: "en" | "he",
): ResourceString[] {
  return [...catalog.strings, ...catalog.patterns].map((entry) => ({
    name: entry.name,
    value: entry[language],
  }));
}

/** Parses and validates the catalog JSON; fails closed on any malformed entry. */
export function parseCatalog(text: string): StringsCatalog {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || data.version !== 1) {
    throw new Error("android-strings.json: unsupported or missing version.");
  }
  const strings = readEntries(data.strings, "strings", false);
  const patterns = readEntries(data.patterns, "patterns", true);
  const seen = new Set<string>();
  for (const { name } of [...strings, ...patterns]) {
    if (seen.has(name))
      throw new Error(`android-strings.json: duplicate name ${name}.`);
    seen.add(name);
  }
  return { version: 1, strings, patterns } as StringsCatalog;
}

function readEntries(
  value: unknown,
  label: string,
  pattern: boolean,
): StringEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`android-strings.json: "${label}" must be an array.`);
  }
  return value.map((entry: unknown, index) => {
    const where = `android-strings.json: ${label}[${index}]`;
    if (!isRecord(entry)) throw new Error(`${where} must be an object.`);
    for (const field of pattern
      ? ["name", "source", "en", "he"]
      : ["name", "en", "he"]) {
      if (typeof entry[field] !== "string") {
        throw new Error(`${where}.${field} must be a string.`);
      }
      // Expo's strings.xml reader throws "Empty string resource not supported" on the next
      // non-clean prebuild, so an empty value fails here with a clearer message.
      if ((field === "en" || field === "he") && entry[field] === "") {
        throw new Error(`${where}.${field} must not be empty.`);
      }
    }
    // Android resource names are Java identifiers; the generator only emits q_<16hex>.
    if (!/^[a-z][a-z0-9_]*$/.test(entry.name as string)) {
      throw new Error(`${where}.name is not a valid Android resource name.`);
    }
    return entry as unknown as StringEntry;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadCatalog(projectRoot: string, catalogPath: string): StringsCatalog {
  const file = path.resolve(projectRoot, catalogPath);
  return parseCatalog(fs.readFileSync(file, "utf8"));
}

export type WithAndroidStringsOptions = {
  /** Catalog path relative to the project root. Defaults to the app's own catalog. */
  catalogPath?: string;
};

const withAndroidStrings: ConfigPlugin<WithAndroidStringsOptions | void> = (
  config,
  options,
) => {
  const catalogPath = options?.catalogPath ?? DEFAULT_CATALOG_PATH;

  // English: values/strings.xml, merged through the shared strings mod so app_name,
  // share_into_scheme and every other plugin's entries survive. The mod escapes on write, so it
  // gets raw text here; escapeAndroidString above is the same rule set (tested for parity),
  // except interior whitespace runs, which the finalized mod below fixes up.
  config = withStringsXml(config, (cfg) => {
    const catalog = loadCatalog(cfg.modRequest.projectRoot, catalogPath);
    const items = resourcesFor(catalog, "en").map(({ name, value }) => {
      const item = AndroidConfig.Resources.buildResourceItem({ name, value });
      (item.$ as Record<string, string>).formatted = "false";
      return item;
    });
    const keep = new Set(items.map((item) => item.$.name));
    const resources = cfg.modResults.resources;
    if (Array.isArray(resources.string)) {
      resources.string = resources.string.filter(
        ({ $: { name } }) =>
          !name.startsWith(GENERATED_PREFIX) || keep.has(name),
      );
    }
    cfg.modResults = AndroidConfig.Strings.setStringItem(items, cfg.modResults);
    return cfg;
  });

  // The strings mod quotes only leading/trailing whitespace, but aapt2 also collapses interior
  // runs of whitespace. Once every other mod has written the file, rewrite the quoted entries with
  // our escaping (which quotes them). Runs last, so nothing can overwrite the result.
  config = withFinalizedMod(config, [
    "android",
    async (cfg) => {
      const catalog = loadCatalog(cfg.modRequest.projectRoot, catalogPath);
      const runs = resourcesFor(catalog, "en").filter(({ value }) =>
        escapeAndroidString(value).startsWith('"'),
      );
      if (runs.length === 0) return cfg;
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/res/values/strings.xml",
      );
      await fs.promises.writeFile(
        file,
        mergeStringsXml(fs.readFileSync(file, "utf8"), runs),
      );
      return cfg;
    },
  ]);

  // Hebrew: values-iw/strings.xml. Written directly, merging into the file if one exists.
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;
      const catalog = loadCatalog(projectRoot, catalogPath);
      const file = path.join(
        platformProjectRoot,
        "app/src/main/res",
        HEBREW_RES_DIR,
        "strings.xml",
      );
      const existing = fs.existsSync(file)
        ? fs.readFileSync(file, "utf8")
        : null;
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(
        file,
        mergeStringsXml(existing, resourcesFor(catalog, "he"), {
          pruneStale: true,
        }),
      );
      return cfg;
    },
  ]);
};

export default withAndroidStrings;
