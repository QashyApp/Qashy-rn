import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TextInputInstance, TextInputProps } from "react-native";

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
  node: TextInputInstance | null;
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

  // The form value as of the last change made here. `value` lags it by the renders a change takes to
  // come back, so a dangling expression typed in that gap must record this, not the stale prop.
  // A value this hook pushed coming back late is only an echo; any other value (the form changed it)
  // takes over.
  const pushedValue = useRef(value);
  const echoes = useRef<string[]>([]);
  const renderedValue = useRef(value);
  useEffect(() => {
    if (renderedValue.current === value) return;
    renderedValue.current = value;
    const echoed = echoes.current.indexOf(value);
    if (echoed >= 0) {
      echoes.current.splice(0, echoed + 1);
      return;
    }
    echoes.current = [];
    pushedValue.current = value;
  }, [value]);
  const push = useCallback((next: string) => {
    pushedValue.current = next;
    echoes.current.push(next);
  }, []);

  const change = useCallback(
    (next: string) => {
      if (mode === "expression") {
        onChangeText(next);
        return;
      }
      const result = evaluateAmountExpression(next, currency, locale);
      if (result.kind === "value") {
        push(result.text);
        setTyped({ expression: next, pushed: result.text });
        onChangeText(result.text);
      } else if (result.kind === "plain") {
        push(next);
        setTyped(undefined);
        onChangeText(next);
      } else {
        setTyped({ expression: next, pushed: pushedValue.current });
      }
    },
    [mode, onChangeText, currency, locale, push],
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
      Pick<TextInputInstance, "blur"> | null | undefined;
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
