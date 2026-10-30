import { Decimal } from "decimal.js";

import type { CurrencyCode } from "@/domain/models";
import {
  currencyDigits,
  isSafeMinor,
  minorToLocalizedDecimalString,
  normalizeDecimalString,
} from "@/utils/money";

/** The four operators an amount field understands, as the keypad types them. */
export const AMOUNT_OPERATORS = ["+", "−", "×", "÷"] as const;
export type AmountOperator = (typeof AMOUNT_OPERATORS)[number];

// What a keyboard (or a paste) may produce for each operator.
const OPERATOR_ALIASES: Readonly<Record<string, AmountOperator>> = {
  "+": "+",
  "-": "−",
  "−": "−",
  "×": "×",
  "*": "×",
  "÷": "÷",
  "/": "÷",
};

export function isAmountOperator(character: string) {
  return character in OPERATOR_ALIASES;
}

export type AmountExpressionResult =
  /** No operator: the text is the amount itself and goes through the ordinary money validation. */
  | { kind: "plain" }
  /** A complete expression, evaluated and rounded to the currency's minor unit. */
  | { kind: "value"; minor: number; text: string }
  /** An operator is present but the expression cannot be evaluated (dangling operator, `÷ 0`, bad number). */
  | { kind: "invalid" };

/**
 * Evaluates an amount typed as arithmetic ("12.50 + 3 × 2").
 *
 * Every step runs in `Decimal`, and the result is rounded to the currency's minor unit exactly
 * once, at the end (half away from zero). Rounding intermediate results would make
 * `10 ÷ 3 × 3` come out as 9.99 instead of 10. Precedence is the usual one: `×` and `÷` bind
 * tighter than `+` and `−`. A leading operator is left to the ordinary money validation, so
 * "-5" is still reported as an amount that must be positive.
 */
export function evaluateAmountExpression(
  input: string,
  currency: CurrencyCode,
  locale: string,
): AmountExpressionResult {
  const text = input.trim();
  const tokens = tokenize(text);
  if (tokens.operators.length === 0 || tokens.leadingOperator)
    return { kind: "plain" };
  if (tokens.numbers.length !== tokens.operators.length + 1)
    return { kind: "invalid" };
  try {
    const digits = currencyDigits(currency, locale);
    const numbers = tokens.numbers.map(
      (token) => new Decimal(normalizeDecimalString(token, locale)),
    );
    // Every typed operand obeys the same decimal-place rule as a plain amount, so "12.555 + 0"
    // cannot round away what "12.555" is refused for. Only a division result is rounded, once,
    // at the end.
    if (numbers.some((number) => number.decimalPlaces() > digits))
      return { kind: "invalid" };
    // First pass folds × and ÷ into the running term; second folds + and −.
    const terms: Decimal[] = [numbers[0]];
    const signs: AmountOperator[] = [];
    tokens.operators.forEach((operator, index) => {
      const next = numbers[index + 1];
      const last = terms.length - 1;
      if (operator === "×") terms[last] = terms[last].mul(next);
      else if (operator === "÷") {
        if (next.isZero()) throw new Error("Division by zero.");
        terms[last] = terms[last].div(next);
      } else {
        signs.push(operator);
        terms.push(next);
      }
    });
    let total = terms[0];
    signs.forEach((sign, index) => {
      total =
        sign === "+"
          ? total.add(terms[index + 1])
          : total.sub(terms[index + 1]);
    });
    const minor = total
      .mul(new Decimal(10).pow(digits))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    if (!isSafeMinor(minor)) return { kind: "invalid" };
    return {
      kind: "value",
      minor,
      text: minorToLocalizedDecimalString(minor, currency, locale),
    };
  } catch {
    return { kind: "invalid" };
  }
}

export type SettledAmount =
  /** The text the field should hold now: the calculation's result, or the amount without its dangling operator. */
  | { kind: "settled"; text: string }
  /** Nothing to finish: the text is already a plain amount (or empty). */
  | { kind: "unchanged" }
  /** What was typed cannot be evaluated even without a dangling operator (`÷ 0`, too many decimals). */
  | { kind: "invalid" };

/**
 * Finishes an amount a person stops typing: a complete calculation becomes its result, and a
 * dangling operator ("12 +") is dropped so what is left ("12") is what the form will save.
 */
export function settleAmountExpression(
  input: string,
  currency: CurrencyCode,
  locale: string,
): SettledAmount {
  const characters = Array.from(input.trimEnd());
  while (
    characters.length > 0 &&
    isAmountOperator(characters[characters.length - 1])
  ) {
    characters.pop();
    while (
      characters.length > 0 &&
      characters[characters.length - 1].trim() === ""
    )
      characters.pop();
  }
  const trimmed = characters.join("");
  const result = evaluateAmountExpression(trimmed, currency, locale);
  if (result.kind === "value") return { kind: "settled", text: result.text };
  if (result.kind === "invalid") return { kind: "invalid" };
  return trimmed === input
    ? { kind: "unchanged" }
    : { kind: "settled", text: trimmed };
}

function tokenize(text: string) {
  const numbers: string[] = [];
  const operators: AmountOperator[] = [];
  let current = "";
  let leadingOperator = false;
  for (const character of text) {
    const operator = OPERATOR_ALIASES[character];
    if (operator === undefined) {
      current += character;
      continue;
    }
    if (current.trim() === "" && numbers.length === 0) leadingOperator = true;
    numbers.push(current.trim());
    operators.push(operator);
    current = "";
  }
  numbers.push(current.trim());
  // A leading operator contributes an empty first number; drop the bookkeeping of that case.
  return { numbers, operators, leadingOperator };
}
