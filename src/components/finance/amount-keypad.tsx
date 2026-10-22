import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type ViewStyle } from "react-native";

import { KeypadPressable } from "@/components/finance/keypad-pressable";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { MotionView } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { type AmountOperator } from "@/utils/amount-expression";
import {
  applyKeypadKey,
  ExpressionBuffer,
  type KeypadKey,
} from "@/utils/amount-keypad";
import { hapticImpactLight, hapticSelection } from "@/services/haptics";
import { decimalSymbolFor } from "@/utils/money";

/** Phones and tablets get the on-screen keypad; a desktop browser keeps typing into the field. */
export function prefersAmountKeypad() {
  if (process.env.EXPO_OS !== "web") return true;
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches === true
    );
  } catch {
    return false;
  }
}

type KeyDefinition = { key: KeypadKey; label: string; a11y: string };

const OPERATOR_NAMES: Record<AmountOperator, string> = {
  "+": "plus",
  "−": "Subtract",
  "×": "Multiply",
  "÷": "Divide",
};

const digit = (value: string): KeyDefinition => ({
  key: { type: "digit", digit: value },
  label: value,
  a11y: value,
});
const operator = (value: AmountOperator): KeyDefinition => ({
  key: { type: "operator", operator: value },
  label: value,
  a11y: OPERATOR_NAMES[value],
});

/**
 * A calculator keypad for the amount field: digits, the locale's decimal key, `+ − × ÷`,
 * backspace and a result key.
 *
 * It exists for two reasons. The system keyboard resizes and reflows the sheet each time it opens,
 * which is most of why the transaction sheet felt heavy on a phone; this keypad rises over the
 * screen instead (see `CalculatorHost`), so the form never moves. And splitting a bill, or adding a tip, no longer needs a
 * calculator app. The field's text is the expression; the form evaluates it with `Decimal` and
 * rounds to the currency's minor unit exactly once (see `evaluateAmountExpression`).
 */
export function AmountKeypad({
  value,
  onChange,
  locale,
  result,
  resolve,
  buffer: sharedBuffer,
}: {
  /** The expression typed so far. */
  value: string;
  onChange: (next: string) => void;
  locale: string;
  /** The evaluated amount while `value` is a complete expression; the result key shows it. */
  result: string | null;
  /** Collapses a complete expression to its evaluated text, or null when it cannot be evaluated. */
  resolve: (expression: string) => string | null;
  /**
   * The buffer keys are applied to, when the caller needs the latest text itself (the keypad's host
   * finishes the calculation from it). Without one the keypad keeps its own.
   */
  buffer?: ExpressionBuffer;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const decimalSymbol = decimalSymbolFor(locale);
  const rows = useMemo(() => keyRows(decimalSymbol), [decimalSymbol]);

  // Every key is applied to the buffer, not to the `value` prop: the prop comes back from the field
  // several renders after a key, and a second key pressed in between must not start from the old text.
  const [ownBuffer] = useState(() => new ExpressionBuffer(value));
  const buffer = sharedBuffer ?? ownBuffer;
  buffer.reconcile(value);
  const latest = useRef({ onChange, resolve, decimalSymbol });
  useEffect(() => {
    latest.current = { onChange, resolve, decimalSymbol };
  });

  const press = useCallback(
    (key: KeypadKey) => {
      const expression = buffer;
      hapticSelection();
      const { onChange, resolve, decimalSymbol } = latest.current;
      const next = applyKeypadKey(expression.value, key, {
        decimalSymbol,
        resolve,
      });
      if (next === expression.value) return;
      expression.push(next);
      onChange(next);
    },
    [buffer],
  );
  const clear = useCallback(() => {
    hapticImpactLight();
    press({ type: "clear" });
  }, [press]);
  const equals = useCallback(() => press({ type: "equals" }), [press]);

  return (
    <View
      accessibilityLabel={t("Amount keypad")}
      role="group"
      style={{ gap: space.sm }}
    >
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: "row", gap: space.sm }}>
          {row.map((definition) => (
            <KeypadButton
              key={definition.a11y}
              definition={definition}
              onKey={press}
              onClear={definition.key.type === "backspace" ? clear : undefined}
            />
          ))}
        </View>
      ))}
      {result !== null ? (
        <MotionView variant="up" exit animateLayout>
          <KeypadPressable
            accessibilityLabel={`${t("Calculate")}, ${result}`}
            onPress={equals}
            style={(pressed) => ({
              minHeight: 48,
              borderRadius: theme.radius.tile,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              ...materialStyle(theme, pressed ? "accentPressed" : "accent"),
            })}
          >
            <AppText
              literal
              figure
              variant="label"
              style={{ color: theme.onAccent }}
            >
              {`= ${result}`}
            </AppText>
          </KeypadPressable>
        </MotionView>
      ) : null}
    </View>
  );
}

function keyRows(decimalSymbol: string): KeyDefinition[][] {
  return [
    [digit("7"), digit("8"), digit("9"), operator("÷")],
    [digit("4"), digit("5"), digit("6"), operator("×")],
    [digit("1"), digit("2"), digit("3"), operator("−")],
    [
      {
        key: { type: "decimal" },
        label: decimalSymbol,
        a11y: "Decimal separator",
      },
      digit("0"),
      { key: { type: "backspace" }, label: "", a11y: "Delete last character" },
      operator("+"),
    ],
  ];
}

const KeypadButton = memo(function KeypadButton({
  definition,
  onKey,
  onClear,
}: {
  definition: KeyDefinition;
  onKey: (key: KeypadKey) => void;
  onClear?: () => void;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const isOperator = definition.key.type === "operator";
  const colorOf = (): string =>
    String(isOperator ? theme.onAccentContainer : theme.text);
  const surface = (pressed: boolean): ViewStyle =>
    isOperator
      ? {
          backgroundColor: theme.accentContainer,
          boxShadow: pressed ? theme.shadowControlPressed : undefined,
        }
      : materialStyle(theme, pressed ? "controlPressed" : "control");
  return (
    <KeypadPressable
      accessibilityLabel={t(definition.a11y)}
      onPress={() => onKey(definition.key)}
      onLongPress={onClear}
      style={(pressed) => ({
        flex: 1,
        minHeight: 52,
        borderRadius: theme.radius.tile,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        ...surface(pressed),
      })}
    >
      {definition.key.type === "backspace" ? (
        <AppIcon name="ion:backspace-outline" color={colorOf()} size={22} />
      ) : (
        <AppText
          literal
          figure
          selectable={false}
          variant="headline"
          style={{ color: colorOf() }}
        >
          {definition.label}
        </AppText>
      )}
    </KeypadPressable>
  );
});
