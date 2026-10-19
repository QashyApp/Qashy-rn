/**
 * Fails when a UI string written as a literal in the app has no Hebrew entry and matches no
 * dynamic pattern, because such a string shows in English in Hebrew and in every Play language
 * (whose translations come from the same dictionary).
 *
 * The scan is static and conservative, over `src/{app,components,features,providers,utils,data}`,
 * so messages built by the repository, the import readers and the utilities are covered too:
 *  1. literal arguments of `t(...)` and `translateCurrent(...)`, through `?:`, `??` and `||`;
 *  2. literal values of the props that components translate or display (`title`, `label`,
 *     `hint`, `placeholder`, `accessibilityLabel`, ...) on any component element;
 *  3. literal text children of `<AppText>`, which translates its string children;
 *  4. positional string arguments of the UI helpers `showError(title, message)` and
 *     `errorMessage(reason, fallback)`, of `corrupt(message)` in the SQLite reader, and the
 *     lists under `imports`, `notImported` and `caveats` in the import sources;
 *  5. string values of object properties named like display text (`label`, `title`, `message`,
 *     `a11y`, `reason`, ...), parameter defaults such as `actionLabel = "Undo"`, and constants
 *     named `*_NAMES`, `*_LABELS`, `*_MESSAGES`, `*_TITLES`, which reach `t()` through a variable;
 *  6. the message of every `new XError(...)` (`ImportError` takes it second): `showError` and
 *     the screens' error texts translate it where it is shown;
 *  7. in `data/` and `utils/`, any string that reads as a sentence, wherever it appears.
 * Elements marked `literal` are skipped: they opt out of translation. A string with no two
 * consecutive letters (numbers, symbols, emoji), a code such as `zero-amount`, or a URL needs no
 * translation.
 *
 * A message built with `${...}` is checked with each substitution left open: it passes when a
 * dictionary key has that shape, or when a pattern translates it with a number, a color, a date,
 * a unit or a counted noun in the holes (a `count(n, "noun")` call yields both its renderings,
 * a `?:` between literals each of its words). If a string is meant to stay English, add it to
 * ALLOWED with the reason; a hole is written `${…}` there.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { IMPORT_SOURCES } from "@/data/import/sources";
import { translateMessage } from "@/localization/localization";
import { createDynamicPatterns, HEBREW } from "@/localization/messages/he";

const SRC = join(__dirname, "..", "..");
const SCANNED = [
  "app",
  "components",
  "features",
  "providers",
  "utils",
  "data",
  "sync",
  "theme",
];

/** Whole files that are English by design or never reach the screen. */
const EXCLUDED_FILES: Record<string, string> = {
  "features/dev/kitchen-sink-screen.tsx":
    "Dev-only component gallery, shown in development builds only.",
  "data/exchange-rates/frankfurter.ts":
    "Diagnostics about the provider's response: the rate service records a failure as an error code, and the screens show that code through translated messages.",
  "data/exchange-rates/rate-client.ts":
    "Diagnostics about the request: the rate service records a failure as an error code, and the screens show that code through translated messages.",
  "data/storage.native.ts":
    "SQL text and a guard against use before `init`, neither shown to the user.",
  "data/storage.web.ts":
    "A guard against use before `init`, never shown to the user.",
};

/** Strings that intentionally stay as written, each with the reason. */
const ALLOWED: Record<string, string> = {
  Qashy: "The brand name is not translated.",
  "Kitchen sink":
    "The dev-only component gallery row, rendered only when `__DEV__` is true.",
  "Dev-only component gallery":
    "The dev-only component gallery row, rendered only when `__DEV__` is true.",
  "Division by zero.":
    "Thrown inside `evaluateAmountExpression`'s try block and reported as `{ kind: 'invalid' }`, never shown.",
  "A prospective validation must be synchronous.":
    "A programming error raised when a validation callback returns a promise, never reachable from the UI.",
  "wellness spa massage":
    "Search keywords of the `body` icon, matched against typed text and never displayed; the key only looks like the `body` text prop.",
  disabled: "A relay health status code compared in code, never shown.",
  ok: "A relay health status code compared in code, never shown.",
  "Unsupported import source: ${…}":
    "The exhaustiveness guard of a `never` switch over the import source ids.",
};

/** Families of strings that intentionally stay as written. */
const ALLOWED_PATTERNS: [RegExp, string][] = [
  [
    /^(?:repetitive|sequential|common)$/,
    "Passphrase weakness codes, mapped to PASSPHRASE_WEAKNESS_MESSAGES (which are translated) and never shown themselves.",
  ],
  [
    /^(?:Rubik|Space Grotesk|Pixelify Sans|Figtree|Inter|Nunito|Atkinson Hyperlegible|Ionicons|Pixel|Material|Fluent Emoji)$/,
    "Font families and icon-set product names (Pixel, Material and Fluent Emoji among them) are proper names, shown as written in every language.",
  ],
  [
    /^use\w+ must be used inside \w+\.$/,
    "A hook called outside its provider is a programming error, caught in development.",
  ],
];

/** Constants whose keys are identifiers, not text. */
const IGNORED_CONSTANTS: Record<string, string> = {
  HEADER_ALIASES:
    'CSV column-name aliases (`title: "title"`) are identifiers matched against a file header, not UI text.',
};

/** Props a component accepts and ignores, so their literals are not shown. */
const IGNORED_PROPS: Record<string, string> = {
  "ColorSwatch.label":
    "ColorSwatch announces `describeColor(color)` instead, and keeps the prop only for type compatibility.",
};

const TEXT_PROPS = new Set([
  "title",
  "subtitle",
  "label",
  "description",
  "body",
  "hint",
  "placeholder",
  "caption",
  "overline",
  "action",
  "secondaryAction",
  "actionLabel",
  "message",
  "accessibilityLabel",
  "accessibilityHint",
  "searchPlaceholder",
  "emptyLabel",
  "confirmLabel",
  "cancelLabel",
  "helper",
  "error",
  "headerTitle",
  "detail",
  "footer",
  "text",
  "confirmMessage",
  "dialogTitle",
]);
const TEXT_KEYS = new Set([
  "label",
  "title",
  "a11y",
  "description",
  "caption",
  "body",
  "subtitle",
  "message",
  "hint",
  "placeholder",
  "overline",
  "detail",
  "reason",
  "headline",
  "summary",
  "tooltip",
  "helper",
  "error",
]);
/** `confirmTitle`, `errorTitle`, `dialogTitle`, `confirmMessage`, `actionLabel`, ... */
const isTextKey = (name: string) =>
  TEXT_KEYS.has(name) ||
  /(?:Title|Message|Label|Hint|Body|Caption|Subtitle|Description|Placeholder)$/.test(
    name,
  );
/** Properties holding a list of sentences that a component renders as text. */
const TEXT_LISTS = new Set([
  "imports",
  "notImported",
  "caveats",
  "errors",
  "warnings",
]);
/** Helper calls whose positional arguments are shown to the user (index of each). */
const TEXT_CALLS: Record<string, number[]> = {
  showError: [0, 1],
  corrupt: [0],
  fail: [0],
  errorMessage: [1],
};
/** Error classes whose message is not the first argument. */
const ERROR_MESSAGE_INDEX: Record<string, number> = { ImportError: 1 };
/** Starts with a capital, has several words and ends like a sentence or a question. */
const SENTENCE = /^[A-Z][^\n]*\s[^\n]*[.?!]$/;
const TEXT_CONSTANT = /(?:NAMES|LABELS|MESSAGES|TITLES)$/;

/**
 * Fragments a pattern hands to the nested translator (a field label, a relative time, a unit):
 * those are English text that must itself be translated. Captures a pattern leaves alone
 * (numbers, amounts, names) are not fragments.
 */
const fragments: string[] = [];
const patterns = createDynamicPatterns((message) => {
  fragments.push(message);
  return message;
});
const needsTranslation = (text: string) =>
  /[A-Za-z]{2}/.test(text) &&
  !/^https?:/.test(text) &&
  // An identifier such as `zero-amount` or `file.name` is a code, not text.
  !/^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/.test(text) &&
  !/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(text);

/** A hole is written `${…}` in a report and in ALLOWED. */
const shown = (text: string) => text.replaceAll(HOLE, "${…}");
const isAllowed = (text: string) =>
  shown(text) in ALLOWED ||
  ALLOWED_PATTERNS.some(([pattern]) => pattern.test(text));

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What a substitution can hold: a number or a name, a color, a date, a unit, nothing (an
 * optional tail), a numbered list and a counted noun.
 */
const SAMPLES = [
  "2",
  "1",
  "#5070FF",
  "2026-07-01",
  "day",
  "expense",
  "",
  "1. A",
  "2 devices",
];

/** Every way of filling `holes` substitutions from `SAMPLES`. */
function fillings(holes: number): string[][] {
  if (holes === 0) return [[]];
  const rest = fillings(holes - 1);
  return SAMPLES.flatMap((sample) => rest.map((tail) => [sample, ...tail]));
}

/**
 * A message with substitutions is translated when a dictionary key has the same shape (the
 * substitutions standing for any text), or when a pattern translates it with some mix of those
 * samples in its holes.
 */
function isTranslatedTemplate(text: string): boolean {
  const parts = text.split(HOLE);
  const shape = new RegExp(`^${parts.map(escapeRegex).join("[^]+")}$`);
  if (Object.keys(HEBREW).some((key) => shape.test(key))) return true;
  // Holes past the fourth take one sample alike (a number, or nothing).
  const tails = ["2", ""];
  return fillings(Math.min(parts.length - 1, 4)).some((filling) =>
    tails.some((tail) =>
      isTranslated(
        parts
          .map(
            (part, index) =>
              part + (index < parts.length - 1 ? (filling[index] ?? tail) : ""),
          )
          .join(""),
      ),
    ),
  );
}

function isTranslated(text: string, depth = 0): boolean {
  if (text.includes(HOLE)) return isTranslatedTemplate(text);
  const core = text.trim();
  if (Object.hasOwn(HEBREW, core)) return true;
  // The first matching pattern wins, as in `translateMessage`.
  const match = patterns.find(([regex]) => regex.test(core));
  if (!match) return false;
  const [regex, replacement] = match;
  fragments.length = 0;
  replacement(...(regex.exec(core)?.slice(1) ?? []));
  const nested = [...fragments];
  return (
    depth < 3 &&
    nested.every(
      (fragment) =>
        !needsTranslation(fragment) || isTranslated(fragment, depth + 1),
    )
  );
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** A plain variable or property chain that holds a count (not a constant or a computed value). */
const COUNT_EXPRESSION =
  /^[a-z][\w.]*(?:[Cc]ount|[Ll]ength|[Tt]otal|copies|[Rr]emaining|[Ii]nterval|[Ss]elected)\w*(?:\s*-\s*\d+)?$/;

/** A template whose substitutions are all counts, with 2 standing in for each. */
function countTemplate(node: ts.TemplateExpression): string | null {
  if (
    !node.templateSpans.every((span) =>
      COUNT_EXPRESSION.test(span.expression.getText()),
    )
  ) {
    return null;
  }
  return (
    node.head.text +
    node.templateSpans.map((span) => `2${span.literal.text}`).join("")
  );
}

/** Stands for a substitution in the text of a template that is not a count. */
const HOLE = "\u0000";

/**
 * The renderings of a substitution that is a call of the plural helper `count(n, "noun")`
 * (`2 nouns`, `1 noun`), or `HOLE` for any other expression.
 */
function substitutions(expression: ts.Expression): string[] {
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "count" &&
    expression.arguments[1] &&
    ts.isStringLiteralLike(expression.arguments[1])
  ) {
    const noun = expression.arguments[1].text;
    return [`2 ${noun}s`, `1 ${noun}`];
  }
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) {
    return substitutions(expression.expression);
  }
  // A word chosen by a condition (`n === 1 ? "row" : "rows"`): each choice is a rendering.
  if (ts.isConditionalExpression(expression)) {
    return [
      ...substitutions(expression.whenTrue),
      ...substitutions(expression.whenFalse),
    ];
  }
  return [HOLE];
}

/** A template with every substitution replaced by `HOLE`: a number, a name or a date alike. */
function sampleTemplate(node: ts.TemplateExpression): string[] {
  return node.templateSpans.reduce(
    (texts, span) =>
      texts.flatMap((text) =>
        substitutions(span.expression).map(
          (substitution) => `${text}${substitution}${span.literal.text}`,
        ),
      ),
    [node.head.text],
  );
}

/**
 * String literals an expression can evaluate to directly (count templates with a 2). With
 * `sampleAll`, any template is sampled, so a message built around a name or a number is
 * checked against the dynamic patterns too.
 */
function literals(node: ts.Node | undefined, sampleAll = false): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    const counted = countTemplate(node);
    if (counted !== null) return [counted];
    return sampleAll ? sampleTemplate(node) : [];
  }
  if (ts.isArrowFunction(node)) {
    return ts.isBlock(node.body) ? [] : literals(node.body, sampleAll);
  }
  if (ts.isParenthesizedExpression(node)) {
    return literals(node.expression, sampleAll);
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...literals(node.whenTrue, sampleAll),
      ...literals(node.whenFalse, sampleAll),
    ];
  }
  if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
    ].includes(node.operatorToken.kind)
  ) {
    return [
      ...literals(node.left, sampleAll),
      ...literals(node.right, sampleAll),
    ];
  }
  return [];
}

/** Literals assigned to `name` in the nearest enclosing function (a `const` initializer). */
function heldLiterals(
  from: ts.Node,
  name: string,
  sampleAll: boolean,
): string[] {
  let scope: ts.Node | undefined = from.parent;
  while (scope && !ts.isFunctionLike(scope)) scope = scope.parent;
  if (!scope) return [];
  const found: string[] = [];
  const look = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found.push(...literals(node.initializer, sampleAll));
    }
    ts.forEachChild(node, look);
  };
  look(scope);
  return found;
}

const inIgnoredConstant = (node: ts.Node) => {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (
      ts.isVariableDeclaration(at) &&
      ts.isIdentifier(at.name) &&
      Object.hasOwn(IGNORED_CONSTANTS, at.name.text)
    ) {
      return true;
    }
  }
  return false;
};

const hasLiteralFlag = (element: ts.JsxOpeningLikeElement) =>
  element.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === "literal",
  );

/** `literal` is set for text on an element that opts out of translation: it shows as written. */
type Found = { text: string; where: string; literal?: true };

function scan(path: string, text = readFileSync(path, "utf8")): Found[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Found[] = [];
  // Messages built in the data layer and the utilities are sampled whatever they interpolate.
  const sampleAll = true;
  const dataLayer = /^(?:data|utils|sync|theme)[\\/]/.test(
    path.slice(SRC.length + 1),
  );
  const lit = (node: ts.Node | undefined) => literals(node, sampleAll);
  const add = (
    texts: string[],
    node: ts.Node,
    how: string,
    literal = false,
  ) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    for (const text of texts) {
      found.push({
        text,
        where: `${path.slice(SRC.length + 1)}:${line} (${how}${literal ? ", literal" : ""})`,
        ...(literal ? { literal: true as const } : null),
      });
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["t", "translateCurrent"].includes(node.expression.text)
    ) {
      const argument = node.arguments[0];
      add(lit(argument), node, `${node.expression.text}()`);
      // A literal held in a variable first: \`const label = cond ? "A" : "B"; t(label)\`.
      if (argument && ts.isIdentifier(argument)) {
        add(
          heldLiterals(node, argument.text, sampleAll),
          node,
          `t(${argument.text})`,
        );
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /Error$/.test(node.expression.text)
    ) {
      // `throw new Error("...")`: the message is shown by `showError` or a screen's error text.
      const index = ERROR_MESSAGE_INDEX[node.expression.text] ?? 0;
      add(lit(node.arguments?.[index]), node, `new ${node.expression.text}()`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      Object.hasOwn(TEXT_CALLS, node.expression.text)
    ) {
      for (const index of TEXT_CALLS[node.expression.text]) {
        add(lit(node.arguments[index]), node, `${node.expression.text}()`);
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      TEXT_LISTS.has(node.name.getText()) &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        add(lit(element), element, node.name.getText());
      }
    }
    if (
      dataLayer &&
      (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
      !ts.isImportDeclaration(node.parent)
    ) {
      // Data-layer and utility sentences reach the screen through returns, helper calls and
      // collected arrays, so any literal that reads as a sentence is checked wherever it is.
      const [sentence] = lit(node);
      if (sentence && SENTENCE.test(sentence))
        add([sentence], node, "sentence");
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const element = node.parent.parent as ts.JsxOpeningLikeElement;
      const tag = element.tagName.getText();
      if (
        /^[A-Z]/.test(tag) &&
        TEXT_PROPS.has(node.name.getText()) &&
        !Object.hasOwn(IGNORED_PROPS, `${tag}.${node.name.getText()}`)
      ) {
        const value = node.initializer;
        add(
          ts.isStringLiteral(value)
            ? [value.text]
            : ts.isJsxExpression(value)
              ? lit(value.expression)
              : [],
          node,
          `<${tag} ${node.name.getText()}>`,
          hasLiteralFlag(element),
        );
      }
    }
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText() === "AppText"
    ) {
      const opted = hasLiteralFlag(node.openingElement);
      for (const child of node.children) {
        if (ts.isJsxText(child)) {
          const text = child.text.replace(/\s+/g, " ").trim();
          if (text) add([text], child, "<AppText> text", opted);
        } else if (ts.isJsxExpression(child)) {
          add(lit(child.expression), child, "<AppText> child", opted);
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      /(?:errors|warnings|details|unsatisfied)$/i.test(
        node.expression.expression.getText(),
      )
    ) {
      // `errors.push("name: must be 1 to 40 characters")`: messages collected for the screen.
      for (const argument of node.arguments) {
        add(
          lit(argument),
          argument,
          `${node.expression.expression.getText()}.push()`,
        );
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      isTextKey(node.name.getText().replace(/["']/g, "")) &&
      !inIgnoredConstant(node)
    ) {
      add(lit(node.initializer), node, `${node.name.getText()}:`);
    }
    if (
      (ts.isParameter(node) || ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name) &&
      isTextKey(node.name.text)
    ) {
      // A default such as `actionLabel = "Undo"` is what shows when the caller passes nothing.
      add(lit(node.initializer), node, `${node.name.text} =`);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      TEXT_CONSTANT.test(node.name.text) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property)) {
          add(lit(property.initializer), property, node.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const everything: Found[] = [
  ...SCANNED.flatMap((directory) => sourceFiles(join(SRC, directory))),
]
  .filter((path) => !(path.slice(SRC.length + 1) in EXCLUDED_FILES))
  .flatMap((path) => scan(path));

describe("literal UI strings", () => {
  it("finds literals to check, so the scan cannot pass by finding nothing", () => {
    expect(everything.length).toBeGreaterThan(500);
    expect(everything.some((found) => found.text === "Connections")).toBe(true);
    expect(everything.some((found) => found.text === "Overview")).toBe(true);
  });

  it("has a Hebrew entry or pattern for every literal, or an allowlist reason", () => {
    // Text on an element marked `literal` is never translated, so a dictionary entry does not
    // help it: it must be wrapped in `t()`, or be allowed.
    const missing = everything.filter(
      ({ text, literal }) =>
        needsTranslation(text) &&
        (literal || !isTranslated(text)) &&
        !isAllowed(text),
    );
    const report = [...new Set(missing.map(({ text }) => text))].map(
      (text) =>
        `${JSON.stringify(shown(text))}\n    ${missing
          .filter((found) => found.text === text)
          .map((found) => found.where)
          .join("\n    ")}`,
    );
    if (report.length > 0) {
      throw new Error(
        `${report.length} UI string(s) have no Hebrew entry. Add each to HEBREW (or a pattern) in src/localization/messages/he.ts and run \`npm run strings:android\`, or add it to ALLOWED with a reason:\n  ${report.join("\n  ")}`,
      );
    }
  });

  it("never lets English words through a pattern that copies its capture", () => {
    // A broad pattern such as `Remove (.+)` translates its frame and copies the capture, so an
    // English sentence it matches would come out as "הסרת the username and ...".
    const leaks = [
      ...new Set(
        everything
          .filter(
            ({ text, literal }) =>
              !literal &&
              !text.includes(HOLE) &&
              needsTranslation(text) &&
              isTranslated(text) &&
              !isAllowed(text),
          )
          .map(({ text }) => text),
      ),
    ].filter((text) =>
      // "Material You" is Google's product name, kept as written in a Hebrew sentence.
      /[A-Za-z]{3,}[ ][A-Za-z]{3,}/.test(
        translateMessage(text, "he").replaceAll("Material You", ""),
      ),
    );
    expect(leaks).toEqual([]);
  });

  it("keeps every allowlist entry in use and explained", () => {
    const seen = new Set(everything.map(({ text }) => shown(text)));
    for (const [text, reason] of Object.entries(ALLOWED)) {
      expect(reason.length).toBeGreaterThan(10);
      expect([text, seen.has(text)]).toEqual([text, true]);
      // An allowlisted string that gains a translation no longer needs the entry.
      expect([text, isTranslated(text.replaceAll("${…}", HOLE))]).toEqual([
        text,
        false,
      ]);
    }
    for (const [pattern, reason] of ALLOWED_PATTERNS) {
      expect(reason.length).toBeGreaterThan(10);
      expect([
        pattern.source,
        everything.some(({ text }) => pattern.test(text)),
      ]).toEqual([pattern.source, true]);
    }
    for (const [file, reason] of Object.entries(EXCLUDED_FILES)) {
      expect(reason.length).toBeGreaterThan(10);
      expect(statSync(join(SRC, file)).isFile()).toBe(true);
    }
    for (const reason of Object.values(IGNORED_PROPS)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("reports a new untranslated literal, and not translated or opted-out ones", () => {
    const fixture = `
      export function Example() {
        const { t } = useLocalization();
        showError("A failure nobody translated yet", "Overview");
        return (
          <>
            <SectionHeader title="A heading nobody translated yet" />
            <SectionHeader title="Overview" />
            <SettingsRow title="Opted out of translation" literal />
            <AppText>A sentence nobody translated yet</AppText>
            <AppText literal>Also opted out</AppText>
            <IconButton label={t("A label nobody translated yet")} />
            <IconButton label={t("Language")} />
          </>
        );
      }
      const SOURCE = { caveats: ["A caveat nobody translated yet", "Overview"] };
      const MODES = { label: "A property nobody translated yet" };
      const RULE_NAMES = { a: "A name nobody translated yet" };
      function Held() {
        const { t } = useLocalization();
        const label = ok ? "A held literal nobody translated" : "Overview";
        return t(label);
      }
      export function Undo({ actionLabel = "A default nobody translated" }) {
        return actionLabel;
      }
      function check(count: number) {
        if (!count) throw new Error("A repository failure nobody translated");
        if (count > 1) throw new Error(\`A \${count} failure nobody translated\`);
        throw new ImportError("corrupt", "An import failure nobody translated");
      }
      const options = {
        errorTitle: "A failure title nobody translated",
        confirmTitle: (count: number) =>
          count === 1 ? "Delete 1 budget?" : \`Delete \${count} widgets and more?\`,
      };
    `;
    const scanned = scan(join(SRC, "features", "fixture.tsx"), fixture);
    const reported = scanned
      .map(({ text }) => text)
      .filter((text) => needsTranslation(text) && !isTranslated(text));
    // Text on an element marked `literal` is never translated: it is reported even when the
    // dictionary has the string, unless it is allowed.
    expect(
      scanned
        .filter(({ literal }) => literal)
        .map(({ text }) => text)
        .sort(),
    ).toEqual(["Also opted out", "Opted out of translation"]);
    expect(reported.sort()).toEqual(
      [
        "Also opted out",
        "Opted out of translation",
        "A failure nobody translated yet",
        "A heading nobody translated yet",
        "A sentence nobody translated yet",
        "A label nobody translated yet",
        "A caveat nobody translated yet",
        "A property nobody translated yet",
        "A name nobody translated yet",
        "A held literal nobody translated",
        "A failure title nobody translated",
        "A default nobody translated",
        "A repository failure nobody translated",
        "A \u0000 failure nobody translated",
        "An import failure nobody translated",
      ].sort(),
    );
    // The real files contain nothing the scan rejects, so a new literal would be the only change.
    expect(isTranslated("A string nobody translated yet")).toBe(false);
    expect(isTranslated("  Overview ")).toBe(true);
    // A pattern that translates a captured fragment needs that fragment translated too, so a
    // broad `(.+)` pattern does not let any English text through.
    expect(isTranslated("Amount is required.")).toBe(true);
    expect(isTranslated("Frobnicate is required.")).toBe(false);
    expect(isTranslated("Every 2 days.")).toBe(true);
    expect(isTranslated("Delete Rainy day fund?")).toBe(true);
  });

  it("covers the import source sentences, and the ones built around each source", () => {
    expect(
      everything.filter((found) =>
        found.where.startsWith("data/import/sources"),
      ).length,
    ).toBeGreaterThanOrEqual(21);
    // The file picker button and the wrong-file message interpolate the source, so every
    // source needs its own whole sentences in the dictionary.
    expect(IMPORT_SOURCES.length).toBeGreaterThan(0);
    for (const source of IMPORT_SOURCES) {
      for (const sentence of [
        source.fileHint,
        `Choose ${source.fileHint} file`,
        `This file does not look like a ${source.name} backup. Choose a ${source.fileHint} file.`,
      ]) {
        expect([sentence, isTranslated(sentence)]).toEqual([sentence, true]);
      }
    }
  });

  it("covers the data layer: repository errors, import warnings and reader errors", () => {
    const where = (prefix: string) =>
      everything.filter((found) => found.where.startsWith(prefix)).length;
    expect(where("data/local-finance-repository")).toBeGreaterThan(100);
    expect(where("data/import/cashew/mapper")).toBeGreaterThan(40);
    expect(where("data/import/cashew/sqlite-reader")).toBeGreaterThan(20);
    expect(where("utils/")).toBeGreaterThan(5);
  });
});
