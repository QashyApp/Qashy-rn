import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

/**
 * Jest runs worklets as plain JS, so a worklet that calls a function without the `"worklet"`
 * directive passes every behavioural test and then throws on the UI runtime. This reads the swipe's
 * sources and checks that everything a worklet calls by name is itself a worklet, or is a callback
 * it was handed, a package export, or a global.
 */

const ROOT = path.resolve(__dirname, "../../../../../..");
const SWIPE_DIR = path.resolve(__dirname, "..");

type FunctionLike =
  ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

function hasWorkletDirective(fn: FunctionLike): boolean {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  for (const statement of body.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    )
      return false;
    if (statement.expression.text === "worklet") return true;
  }
  return false;
}

function parse(fileName: string, text: string) {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Every function in the file that has a name: declarations and `const name = () => {}`. */
function namedFunctions(source: ts.SourceFile) {
  const found = new Map<string, FunctionLike>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name)
      found.set(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isFunctionLike(node.initializer)
    )
      found.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveModule(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = path.join(ROOT, "src", specifier.slice(2));
  for (const extension of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (fs.existsSync(base + extension)) return base + extension;
  }
  return null;
}

/** The calls a worklet makes to something that is not a worklet. */
function findNonWorkletCalls(fileName: string, text: string): string[] {
  const source = parse(fileName, text);
  const locals = namedFunctions(source);
  const imports = new Map<string, { module: string; imported: string }>();
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        imports.set(element.name.text, {
          module: statement.moduleSpecifier.text,
          imported: (element.propertyName ?? element.name).text,
        });
      }
    }
  }

  const importedWorklet = (name: string): boolean | null => {
    const entry = imports.get(name);
    if (!entry) return null;
    const file = resolveModule(entry.module);
    // A package export (reanimated, gesture handler) or a path this test cannot follow.
    if (!file) return true;
    const target = namedFunctions(parse(file, fs.readFileSync(file, "utf8")));
    const fn = target.get(entry.imported);
    return fn ? hasWorkletDirective(fn) : true;
  };

  const problems: string[] = [];
  const checkWorklet = (fn: FunctionLike, label: string) => {
    const paramsInScope: Set<string>[] = [];
    const visit = (node: ts.Node) => {
      if (isFunctionLike(node)) {
        paramsInScope.push(
          new Set(
            node.parameters.flatMap((parameter) =>
              ts.isIdentifier(parameter.name) ? [parameter.name.text] : [],
            ),
          ),
        );
        ts.forEachChild(node, visit);
        paramsInScope.pop();
        return;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (!paramsInScope.some((params) => params.has(name))) {
          const local = locals.get(name);
          if (local && !hasWorkletDirective(local))
            problems.push(`${label} calls ${name}, which is not a worklet`);
          else if (!local && importedWorklet(name) === false)
            problems.push(
              `${label} calls the imported ${name}, which is not a worklet`,
            );
        }
      }
      ts.forEachChild(node, visit);
    };
    paramsInScope.push(
      new Set(
        fn.parameters.flatMap((parameter) =>
          ts.isIdentifier(parameter.name) ? [parameter.name.text] : [],
        ),
      ),
    );
    ts.forEachChild(fn, visit);
  };

  const find = (node: ts.Node) => {
    if (isFunctionLike(node) && hasWorkletDirective(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line;
      checkWorklet(node, `${path.basename(fileName)}:${line + 1}`);
      // Nested worklets are checked through their parent's walk.
      return;
    }
    ts.forEachChild(node, find);
  };
  find(source);
  return problems;
}

describe("worklets in the row swipe", () => {
  const files = fs
    .readdirSync(SWIPE_DIR)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => path.join(SWIPE_DIR, name));

  it("finds the swipe's sources", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((file) => [path.basename(file), file]))(
    "%s only calls worklets from worklet code",
    (_name, file) => {
      expect(findNonWorkletCalls(file, fs.readFileSync(file, "utf8"))).toEqual(
        [],
      );
    },
  );

  it("flags a worklet that calls a helper without the directive", () => {
    const snippet = `
      import { actionLeavesList } from "@/features/transactions/list/row-swipe/row-swipe-actions";
      import { findRowAt } from "@/features/transactions/list/row-swipe/resolve-row-swipe";
      function plain() { return 1; }
      export const run = (kind: string, done: () => void) => {
        runOnUI(() => {
          "worklet";
          actionLeavesList(kind);
          findRowAt([], [], 0);
          plain();
          done();
        })();
      };
    `;
    const problems = findNonWorkletCalls("snippet.ts", snippet);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("actionLeavesList");
    expect(problems.join("\n")).toContain("plain");
  });
});
