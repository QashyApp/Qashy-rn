import { useImperativeHandle, useState, type ComponentProps } from "react";
import type { TextInput } from "react-native";

import { useCalculatorInput } from "@/components/finance/use-calculator-input";
import { FormField } from "@/components/ui/form-field";
import type { CurrencyCode } from "@/domain/models";

type MoneyFieldProps = Omit<
  ComponentProps<typeof FormField>,
  "keyboardType" | "inputMode" | "value" | "onChangeText"
> & {
  value: string;
  onChangeText: (value: string) => void;
  /** The currency the amount is in. */
  currency: CurrencyCode;
};

/**
 * A `FormField` for an amount of money. Its keyboard is the calculator keypad, which appears when the
 * field is focused (see `useCalculatorInput`), so it takes arithmetic as well as a plain number.
 */
export function MoneyField({
  value,
  onChangeText,
  currency,
  onFocus,
  ref,
  ...props
}: MoneyFieldProps) {
  const [node, setNode] = useState<TextInput | null>(null);
  const calculator = useCalculatorInput({
    node,
    value,
    onChangeText,
    currency,
  });
  useImperativeHandle(ref, () => node as TextInput, [node]);
  return (
    <FormField
      {...props}
      {...calculator.inputProps}
      ref={setNode}
      value={calculator.value}
      onChangeText={calculator.onChangeText}
      onFocus={(event) => {
        calculator.onFocus();
        onFocus?.(event);
      }}
    />
  );
}
