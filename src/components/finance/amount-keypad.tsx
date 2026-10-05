import { View, type ViewStyle } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { MotionPressable, MotionView } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { type AmountOperator } from "@/utils/amount-expression";
import { applyKeypadKey, type KeypadKey } from "@/utils/amount-keypad";
import { hapticImpactLight, hapticSelection } from "@/utils/haptics";
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
  "+": "Add",
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
}: {
  /** The expression typed so far. */
  value: string;
  onChange: (next: string) => void;
  locale: string;
  /** The evaluated amount while `value` is a complete expression; the result key shows it. */
  result: string | null;
  /** Collapses a complete expression to its evaluated text, or null when it cannot be evaluated. */
  resolve: (expression: string) => string | null;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const decimalSymbol = decimalSymbolFor(locale);
  const rows: KeyDefinition[][] = [
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

  const press = (key: KeypadKey) => {
    hapticSelection();
    onChange(applyKeypadKey(value, key, { decimalSymbol, resolve }));
  };

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
              onPress={() => press(definition.key)}
              onLongPress={
                definition.key.type === "backspace"
                  ? () => {
                      hapticImpactLight();
                      onChange("");
                    }
                  : undefined
              }
            />
          ))}
        </View>
      ))}
      {result !== null ? (
        <MotionView variant="up" exit animateLayout>
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={`${t("Calculate")}, ${result}`}
            onPress={() => press({ type: "equals" })}
            style={({ pressed }) => ({
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
          </MotionPressable>
        </MotionView>
      ) : null}
    </View>
  );
}

function KeypadButton({
  definition,
  onPress,
  onLongPress,
}: {
  definition: KeyDefinition;
  onPress: () => void;
  onLongPress?: () => void;
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
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={t(definition.a11y)}
      onPress={onPress}
      onLongPress={onLongPress}
      pressedScale={theme.motion.pressScale}
      style={({ pressed }) => ({
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
    </MotionPressable>
  );
}
