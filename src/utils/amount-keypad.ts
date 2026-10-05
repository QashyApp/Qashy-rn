import {
  AMOUNT_OPERATORS,
  isAmountOperator,
  type AmountOperator,
} from "@/utils/amount-expression";

export type KeypadKey =
  | { type: "digit"; digit: string }
  | { type: "decimal" }
  | { type: "operator"; operator: AmountOperator }
  | { type: "backspace" }
  | { type: "clear" }
  | { type: "equals" };

/** Enough for any amount `Decimal` and a safe-integer minor unit can hold, with room for a few terms. */
const MAX_LENGTH = 40;

export const KEYPAD_OPERATORS = AMOUNT_OPERATORS;

export interface KeypadContext {
  /** The locale's decimal symbol, typed by the decimal key. */
  decimalSymbol: string;
  /** The evaluated text for a complete expression, or null when it cannot be evaluated. */
  resolve: (expression: string) => string | null;
}

/**
 * The text field's next value after a key press. Pure, so every keypad rule is testable without
 * rendering. The rules keep the text one the expression parser can read: no leading operator, one
 * operator between numbers (a second press replaces the first), one decimal symbol per number,
 * and no stacked leading zeros.
 */
export function applyKeypadKey(
  expression: string,
  key: KeypadKey,
  { decimalSymbol, resolve }: KeypadContext,
): string {
  const last = lastCharacter(expression);
  const currentNumber = trailingNumber(expression);
  switch (key.type) {
    case "digit": {
      if (expression.length >= MAX_LENGTH) return expression;
      // "0" then "5" is "5", and "0" then "0" stays "0".
      if (currentNumber === "0") {
        return key.digit === "0"
          ? expression
          : expression.slice(0, -1) + key.digit;
      }
      return expression + key.digit;
    }
    case "decimal": {
      if (expression.length >= MAX_LENGTH) return expression;
      if (currentNumber.includes(decimalSymbol)) return expression;
      return currentNumber === ""
        ? `${expression}0${decimalSymbol}`
        : expression + decimalSymbol;
    }
    case "operator": {
      // Amounts are positive, so there is nothing for a leading operator to apply to.
      if (expression === "") return expression;
      if (isAmountOperator(last))
        return expression.slice(0, -last.length) + key.operator;
      return expression.length >= MAX_LENGTH
        ? expression
        : expression + key.operator;
    }
    case "backspace":
      return expression.slice(0, expression.length - last.length);
    case "clear":
      return "";
    case "equals":
      return resolve(expression) ?? expression;
  }
}

function lastCharacter(value: string) {
  return value === "" ? "" : (Array.from(value).at(-1) ?? "");
}

/** The number being typed: everything after the last operator. */
function trailingNumber(expression: string) {
  let index = expression.length;
  while (index > 0) {
    const character = expression[index - 1];
    if (isAmountOperator(character)) break;
    index -= 1;
  }
  return expression.slice(index);
}
