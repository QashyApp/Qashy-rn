import { useCallback, useEffect, useId, useState } from "react";
import type { TextInput, TextInputProps } from "react-native";

import { prefersAmountKeypad } from "@/components/finance/amount-keypad";
import { useCalculatorHost } from "@/components/finance/calculator-host";
import type { CurrencyCode } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import { evaluateAmountExpression } from "@/utils/amount-expression";

/**
 * Makes a money text field a calculator field.
 *
 * Where there is a `CalculatorHost` and a touch screen, the field never raises the system keyboard:
 * focusing it opens the host's keypad instead. Elsewhere (a desktop browser, a screen without a host)
 * it is an ordinary decimal field, and arithmetic can still be typed into it.
 *
 * `mode` decides who owns the expression. `evaluate` (the default) keeps it here and hands the form a
 * plain amount: a complete calculation is evaluated into the form's value as it is typed, and a
 * dangling one leaves the form's last amount alone. `expression` passes the text straight through, for
 * a form (the transaction form) that evaluates the expression itself.
 */
export function useCalculatorInput({
  node,
  value,
  onChangeText,
  currency,
  mode = "evaluate",
}: {
  /** The field's input, once mounted (kept in state by the caller: `ref={setNode}`). */
  node: TextInput | null;
  value: string;
  onChangeText: (next: string) => void;
  currency: CurrencyCode;
  mode?: "evaluate" | "expression";
}) {
  const host = useCalculatorHost();
  const { locale } = useLocalization();
  const keypad = host !== null && prefersAmountKeypad();
  const id = useId();
  // The expression being typed and the form value it produced. While the form still holds that
  // value the field shows the expression; if the form changes it by itself, the field follows.
  const [typed, setTyped] = useState<{ expression: string; pushed: string }>();
  const shown =
    mode === "evaluate" && typed && typed.pushed === value
      ? typed.expression
      : value;

  const change = useCallback(
    (next: string) => {
      if (mode === "expression") {
        onChangeText(next);
        return;
      }
      const result = evaluateAmountExpression(next, currency, locale);
      if (result.kind === "value") {
        setTyped({ expression: next, pushed: result.text });
        onChangeText(result.text);
      } else if (result.kind === "plain") {
        setTyped(undefined);
        onChangeText(next);
      } else {
        setTyped({ expression: next, pushed: value });
      }
    },
    [mode, onChangeText, currency, locale, value],
  );

  const blur = useCallback(() => node?.blur(), [node]);
  useEffect(() => {
    if (keypad)
      host.sync(id, { value: shown, onChange: change, currency, blur });
  }, [keypad, host, id, shown, change, currency, blur]);
  useEffect(() => {
    if (!host) return;
    return () => host.release(id);
  }, [host, id]);

  const onFocus = (event?: { currentTarget?: unknown }) => {
    if (!keypad) return;
    // A field that focuses itself as it mounts (`autoFocus`) does so before `node` reaches state, so
    // the focus event's own target is what can give the focus up.
    const target = (node ?? event?.currentTarget) as
      Pick<TextInput, "blur"> | null | undefined;
    host.open(id, {
      value: shown,
      onChange: change,
      currency,
      blur: () => target?.blur?.(),
    });
  };

  const inputProps: Pick<
    TextInputProps,
    "inputMode" | "keyboardType" | "showSoftInputOnFocus"
  > = keypad
    ? { inputMode: "none", showSoftInputOnFocus: false }
    : { inputMode: "decimal", keyboardType: "decimal-pad" };

  return {
    value: shown,
    onChangeText: change,
    onFocus,
    inputProps,
  };
}
