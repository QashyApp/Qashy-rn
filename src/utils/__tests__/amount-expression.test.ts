import {
  evaluateAmountExpression,
  type AmountExpressionResult,
} from "@/utils/amount-expression";
import { applyKeypadKey, type KeypadKey } from "@/utils/amount-keypad";

const evaluate = (input: string, currency = "USD", locale = "en-US") =>
  evaluateAmountExpression(input, currency, locale);

const value = (result: AmountExpressionResult) =>
  result.kind === "value" ? result.minor : result.kind;

describe("evaluateAmountExpression", () => {
  it("leaves text without an operator to the ordinary money validation", () => {
    expect(evaluate("12.50")).toEqual({ kind: "plain" });
    expect(evaluate("")).toEqual({ kind: "plain" });
    expect(evaluate("-5")).toEqual({ kind: "plain" });
  });

  it("adds, subtracts, multiplies and divides", () => {
    expect(value(evaluate("12.50 + 3"))).toBe(1550);
    expect(value(evaluate("20 − 4.25"))).toBe(1575);
    expect(value(evaluate("3 × 4.5"))).toBe(1350);
    expect(value(evaluate("9 ÷ 4"))).toBe(225);
  });

  it("accepts the ASCII operators a keyboard or a paste produces", () => {
    expect(value(evaluate("2*3+1"))).toBe(700);
    expect(value(evaluate("10/4-1"))).toBe(150);
  });

  it("gives × and ÷ precedence over + and −", () => {
    expect(value(evaluate("2 + 3 × 4"))).toBe(1400);
    expect(value(evaluate("20 − 6 ÷ 2"))).toBe(1700);
    expect(value(evaluate("1 + 2 × 3 + 4"))).toBe(1100);
  });

  it("rounds to minor units once, at the end", () => {
    // Rounding 10 ÷ 3 to 3.33 first would make this 9.99.
    expect(value(evaluate("10 ÷ 3 × 3"))).toBe(1000);
    expect(value(evaluate("1 ÷ 3"))).toBe(33);
    expect(value(evaluate("2 ÷ 3"))).toBe(67);
    // Half rounds up.
    expect(value(evaluate("0.01 × 0.5"))).toBe(1);
  });

  it("respects the currency's minor-unit digits", () => {
    expect(value(evaluate("1000 ÷ 3", "JPY"))).toBe(333);
    expect(value(evaluate("1 ÷ 3", "KWD"))).toBe(333);
  });

  it("reads and writes the locale's decimal symbol", () => {
    const result = evaluate("1,5 + 2,25", "EUR", "de-DE");
    expect(result).toEqual({ kind: "value", minor: 375, text: "3,75" });
  });

  it("applies the minor-unit decimal rule to every typed operand", () => {
    // A plain "12.555" is refused by the money rules, so an expression must not round it away.
    expect(evaluate("12.555 + 0").kind).toBe("invalid");
    expect(evaluate("0 + 12.555").kind).toBe("invalid");
    expect(evaluate("2 × 1.005").kind).toBe("invalid");
    expect(evaluate("1000 + 1.5", "JPY").kind).toBe("invalid");
    expect(evaluate("12.55 + 0")).toEqual({
      kind: "value",
      minor: 1255,
      text: "12.55",
    });
    // Division is the one place a result may need rounding; its operands must still be exact.
    expect(value(evaluate("10 ÷ 3"))).toBe(333);
    expect(evaluate("10.555 ÷ 3").kind).toBe("invalid");
  });

  it("reports incomplete or impossible expressions as invalid", () => {
    expect(evaluate("12 +").kind).toBe("invalid");
    expect(evaluate("5 ÷ 0").kind).toBe("invalid");
    expect(evaluate("5 + + 3").kind).toBe("invalid");
    expect(evaluate("abc + 1").kind).toBe("invalid");
    expect(evaluate("9007199254740991 × 10").kind).toBe("invalid");
  });

  it("returns the localized text the amount field would hold", () => {
    expect(evaluate("0.1 + 0.2")).toEqual({
      kind: "value",
      minor: 30,
      text: "0.30",
    });
  });
});

describe("applyKeypadKey", () => {
  const context = {
    decimalSymbol: ".",
    resolve: (expression: string) => {
      const result = evaluate(expression);
      return result.kind === "value" ? result.text : null;
    },
  };
  const parseKey = (key: string): KeypadKey => {
    if (/^\d$/.test(key)) return { type: "digit", digit: key };
    if (key === ".") return { type: "decimal" };
    if (key === "<") return { type: "backspace" };
    if (key === "C") return { type: "clear" };
    if (key === "=") return { type: "equals" };
    return { type: "operator", operator: key as "+" | "−" | "×" | "÷" };
  };
  const press = (expression: string, ...keys: string[]) =>
    keys.reduce<string>(
      (current, key) => applyKeypadKey(current, parseKey(key), context),
      expression,
    );

  it("types digits and one decimal symbol per number", () => {
    expect(press("", "1", "2", ".", "5", ".", "0")).toBe("12.50");
    expect(press("", ".", "5")).toBe("0.5");
    expect(press("", "3", "+", ".", "5")).toBe("3+0.5");
  });

  it("does not stack leading zeros", () => {
    expect(press("", "0", "0", "0")).toBe("0");
    expect(press("", "0", "7")).toBe("7");
    expect(press("", "5", "+", "0", "0")).toBe("5+0");
  });

  it("ignores a leading operator and replaces a repeated one", () => {
    expect(press("", "+", "×")).toBe("");
    expect(press("", "5", "+", "−")).toBe("5−");
    expect(press("", "5", "×", "÷", "2")).toBe("5÷2");
  });

  it("backspaces one character and clears everything", () => {
    expect(press("12+3", "<")).toBe("12+");
    expect(press("", "<")).toBe("");
    expect(press("12+3", "C")).toBe("");
  });

  it("equals collapses a complete expression to its result", () => {
    expect(press("", "1", "0", "÷", "4", "=")).toBe("2.50");
    // An incomplete expression stays as typed.
    expect(press("", "1", "0", "÷", "=")).toBe("10÷");
  });

  it("types the locale's decimal symbol", () => {
    expect(
      applyKeypadKey(
        "1",
        { type: "decimal" },
        { ...context, decimalSymbol: "," },
      ),
    ).toBe("1,");
  });
});
