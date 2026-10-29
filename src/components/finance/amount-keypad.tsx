import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { KeypadPressable } from "@/components/finance/keypad-pressable";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import {
  motionCurves,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion";
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

  // A key that changes nothing (a second decimal point, delete on an empty field) buzzes nothing.
  const apply = useCallback(
    (key: KeypadKey, buzz: () => void) => {
      const expression = buffer;
      const { onChange, resolve, decimalSymbol } = latest.current;
      const next = applyKeypadKey(expression.value, key, {
        decimalSymbol,
        resolve,
      });
      if (next === expression.value) return;
      buzz();
      expression.push(next);
      onChange(next);
    },
    [buffer],
  );
  const press = useCallback(
    (key: KeypadKey) => apply(key, hapticSelection),
    [apply],
  );
  // Clearing is one heavier tap, not that tap and the key's own tick on top of it.
  const clear = useCallback(
    () => apply({ type: "clear" }, hapticImpactLight),
    [apply],
  );
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
      <ResultKey result={result} onPress={equals} />
    </View>
  );
}

/**
 * The "= result" key. It always takes its place, so the panel (which is anchored to the bottom of
 * the screen) does not grow by a row, and push the keys up under the finger, the moment an
 * expression becomes complete. Without a result it is invisible, cannot be touched or focused, and
 * is hidden from screen readers.
 */
function ResultKey({
  result,
  onPress,
}: {
  result: string | null;
  onPress: () => void;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const { instant } = useMotionPreference();
  const durations = useMotionDurations();
  // The last result stays drawn while the key fades out.
  const [shown, setShown] = useState(result ?? "");
  if (result !== null && result !== shown) setShown(result);
  const visible = result !== null;
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacity.set(
      withTiming(visible ? 1 : 0, {
        duration: visible ? durations.enter : durations.exit,
        easing: visible ? motionCurves.standard : motionCurves.exit,
        reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
      }),
    );
  }, [visible, durations, instant, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      {...(!visible && process.env.EXPO_OS === "web" ? WEB_INERT : null)}
      style={fade}
    >
      <KeypadPressable
        accessibilityLabel={`${t("Calculate")}, ${shown}`}
        onPress={onPress}
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
          {`= ${shown}`}
        </AppText>
      </KeypadPressable>
    </Animated.View>
  );
}

// `inert` is a DOM attribute react-native-web forwards but the View types do not list.
const WEB_INERT = { inert: true } as const;

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
      longPressLabel={t("Clear")}
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
