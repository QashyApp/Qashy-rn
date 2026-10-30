import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

/**
 * The worklets Babel plugin does not capture identifiers that appear only in a parameter default,
 * so `function f(edge = EDGE) { "worklet"; }` runs fine in Jest (plain JS) and then throws
 * `ReferenceError: Property 'EDGE' doesn't exist` on the UI runtime. This reads every source file
 * and checks that the parameters of each worklet, including callbacks the plugin workletizes
 * itself (gesture builders, `useAnimatedStyle`, `useFrameCallback`, ...), default only to literals.
 * Resolve any other default inside the body instead.
 */

const SRC_DIR = path.resolve(__dirname, "..");
const ROOT = path.resolve(SRC_DIR, "..");

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
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

/** Hooks and functions whose function arguments the Babel plugin turns into worklets. */
const WORKLET_HOOKS = new Set([
  "useAnimatedStyle",
  "useAnimatedProps",
  "useDerivedValue",
  "useAnimatedReaction",
  "useFrameCallback",
  "useAnimatedScrollHandler",
  "useAnimatedGestureHandler",
  "useAnimatedKeyboard",
  "useScrollViewOffset",
  "useWorkletCallback",
  "runOnUI",
  "runOnUISync",
  "runOnRuntime",
  "scheduleOnUI",
  "scheduleOnRN",
  "executeOnUIRuntimeSync",
  "createWorkletRuntime",
  "withTiming",
  "withSpring",
  "withDecay",
  "withRepeat",
  "withSequence",
  "withDelay",
  "withClamp",
]);

/** Gesture-builder methods (`Gesture.Pan().onUpdate(...)`) whose callbacks are workletized. */
const GESTURE_CALLBACKS = new Set([
  "onBegin",
  "onStart",
  "onUpdate",
  "onChange",
  "onEnd",
  "onFinalize",
  "onTouchesDown",
  "onTouchesMove",
  "onTouchesUp",
  "onTouchesCancelled",
]);

function isAutoWorkletized(fn: FunctionLike): boolean {
  const call = fn.parent;
  if (!call || !ts.isCallExpression(call)) return false;
  if (!call.arguments.includes(fn as ts.Expression)) return false;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return WORKLET_HOOKS.has(callee.text);
  if (ts.isPropertyAccessExpression(callee))
    return (
      GESTURE_CALLBACKS.has(callee.name.text) ||
      WORKLET_HOOKS.has(callee.name.text)
    );
  return false;
}

/** Defaults that capture nothing: numbers, strings, booleans, null, undefined, empty literals. */
function isLiteralDefault(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node))
    return isLiteralDefault(node.expression);
  if (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isBigIntLiteral(node)
  )
    return true;
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  )
    return true;
  if (ts.isIdentifier(node)) return node.text === "undefined";
  if (ts.isPrefixUnaryExpression(node))
    return (
      (node.operator === ts.SyntaxKind.MinusToken ||
        node.operator === ts.SyntaxKind.PlusToken) &&
      ts.isNumericLiteral(node.operand)
    );
  if (ts.isArrayLiteralExpression(node)) return node.elements.length === 0;
  if (ts.isObjectLiteralExpression(node)) return node.properties.length === 0;
  return false;
}

/** Every initializer inside a parameter's binding pattern, including the parameter's own. */
function defaultsOf(parameter: ts.ParameterDeclaration): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isParameter(node) || ts.isBindingElement(node)) && node.initializer)
      found.push(node.initializer);
    if (ts.isBindingElement(node) || ts.isParameter(node)) {
      if (!ts.isIdentifier(node.name)) visit(node.name);
    } else {
      ts.forEachChild(node, visit);
    }
  };
  visit(parameter);
  return found;
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

/** Worklet parameters whose default is anything but a literal, as `file:line` messages. */
export function findWorkletDefaults(fileName: string, text: string): string[] {
  const source = parse(fileName, text);
  const problems: string[] = [];
  const visit = (node: ts.Node, insideWorklet: boolean) => {
    let inside = insideWorklet;
    if (isFunctionLike(node)) {
      inside =
        insideWorklet || hasWorkletDirective(node) || isAutoWorkletized(node);
      if (inside) {
        for (const parameter of node.parameters) {
          for (const initializer of defaultsOf(parameter)) {
            if (isLiteralDefault(initializer)) continue;
            const line =
              source.getLineAndCharacterOfPosition(initializer.getStart())
                .line + 1;
            problems.push(
              `${path.basename(fileName)}:${line} worklet parameter default \`${initializer.getText()}\` is not a literal`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  return problems;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name))
      files.push(full);
  }
  return files;
}

describe("worklet parameter defaults", () => {
  const roots = [SRC_DIR, path.join(ROOT, "modules")].filter((dir) =>
    fs.existsSync(dir),
  );
  const files = roots.flatMap(sourceFiles);

  it("finds the app's sources", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no worklet whose parameter default references an identifier", () => {
    const problems = files.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      // Skip files that cannot contain a worklet before parsing them.
      if (!/worklet|use[A-Z]\w*|runOnUI|scheduleOnUI|\.on[A-Z]\w*\(/.test(text))
        return [];
      return findWorkletDefaults(file, text).map(
        (problem) => `${path.relative(ROOT, file)}: ${problem}`,
      );
    });
    expect(problems).toEqual([]);
  });

  it("flags a defaulted identifier on a worklet declaration", () => {
    const snippet = `
      const EDGE = 80;
      export function step(y: number, edge: number = EDGE) {
        "worklet";
        return y + edge;
      }
    `;
    expect(findWorkletDefaults("snippet.ts", snippet)).toHaveLength(1);
  });

  it("flags destructuring defaults and workletized callbacks", () => {
    const snippet = `
      const LIMIT = 3;
      export const pan = Gesture.Pan().onUpdate(({ x = LIMIT }) => { void x; });
      export const style = useAnimatedStyle((k = clamp(1)) => ({ opacity: k }));
      export const inner = () => {
        "worklet";
        return (value = LIMIT) => value;
      };
    `;
    expect(findWorkletDefaults("snippet.ts", snippet)).toHaveLength(3);
  });

  it("accepts literal defaults and plain functions", () => {
    const snippet = `
      const EDGE = 80;
      export function a(x = 0, y = false, z = -1, s = "a", n = null) {
        "worklet";
        return [x, y, z, s, n];
      }
      export function plain(edge = EDGE) { return edge; }
    `;
    expect(findWorkletDefaults("snippet.ts", snippet)).toEqual([]);
  });
});
