import { useImperativeHandle, useState, type Ref } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";

import { useCalculatorInput } from "@/components/finance/use-calculator-input";
import { AppText } from "@/components/ui/app-text";
import { MotionView } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme, type ThemeTokens } from "@/theme/theme";
import type { TypeScaleSpec } from "@/theme/themes/types";
import { withAppFont } from "@/theme/typography";

type AmountHeroSize = "hero" | "display" | "money";

/**
 * Per-`size` layout: the large centered numeric well with a currency pill
 * that every amount-first field in Qashy shares. `hero` is the transaction
 * form's own full-bleed treatment (no visible label above the well). The
 * other two sizes render a visible label above the well, sized down to fit
 * a form alongside other fields.
 */
const sizeConfig = ({
  space,
  radius,
}: Pick<ThemeTokens, "space" | "radius">): Record<
  AmountHeroSize,
  {
    face: keyof TypeScaleSpec;
    radius: number;
    paddingVertical: number;
    paddingHorizontal: number;
    showLabel: boolean;
  }
> => ({
  hero: {
    face: "hero",
    radius: radius.sheet,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    showLabel: false,
  },
  display: {
    face: "display",
    radius: radius.sheet,
    paddingVertical: space.xl,
    paddingHorizontal: space.xl,
    showLabel: true,
  },
  money: {
    face: "money",
    radius: radius.tile,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    showLabel: true,
  },
});

/**
 * The shared amount-first hero for every "big number in a sunken well with a
 * currency pill" field in Qashy: the transaction form's `Amount`, a budget's
 * `Total limit`, a goal's `Target`, and onboarding's `Opening balance`.
 *
 * The three call sites this replaces disagreed on more than layout — whether
 * the accessible name folds the currency into the translated string or
 * appends it afterwards, whether the field is required, and whether a hint
 * is always visible or only the error is. Those differences are exposed as
 * props (`currencyInTranslation`, `required`, `hint`) rather than papered
 * over, so each caller keeps producing exactly the accessible name and
 * behavior it always has.
 */
export function AmountHero({
  value,
  onChangeText,
  currency,
  label = "Amount",
  size = "hero",
  error,
  autoFocus = false,
  hint,
  required = true,
  /**
   * `true` (the default): the whole `"Label (currency)"` string is passed to
   * `t()` together, matching the dictionary's `^Label \((.+)\)$` patterns
   * (used by "Amount" and "Opening balance"). `false`: only the label is
   * translated and `(currency)` is appended afterwards, untranslated —
   * matches the Plan forms' "Target"/"Total limit" hero, which never ran the
   * combined string through the dictionary.
   */
  currencyInTranslation = true,
  onCurrencyPress,
  onSubmitEditing,
  returnKeyType,
  placeholder = "0.00",
  onBlur,
  calculator = "evaluate",
  ref,
}: {
  value: string;
  onChangeText: (value: string) => void;
  currency: string;
  /** Untranslated base label, e.g. "Amount", "Target", "Opening balance". */
  label?: string;
  size?: AmountHeroSize;
  error?: string;
  autoFocus?: boolean;
  /**
   * When provided, always rendered beneath the well (swapped for the error
   * when one is present), like `OpeningBalanceHero`. Omit it to only ever
   * show the error line, like `AmountHero`/`PlanAmountHero`.
   */
  hint?: string;
  required?: boolean;
  currencyInTranslation?: boolean;
  onCurrencyPress?: () => void;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps["returnKeyType"];
  placeholder?: string;
  /** Called alongside the field's own internal blur handling. */
  onBlur?: () => void;
  /**
   * How the calculator keypad (see `CalculatorHost`) hands the amount to the form: `evaluate` gives
   * it a plain amount, `expression` gives it the text typed so far, for a form that evaluates it.
   */
  calculator?: "evaluate" | "expression";
  ref?: Ref<TextInput>;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { isRtl, t } = useLocalization();
  const [node, setNode] = useState<TextInput | null>(null);
  const input = useCalculatorInput({
    node,
    value,
    onChangeText,
    currency,
    mode: calculator,
  });
  useImperativeHandle(ref, () => node as TextInput, [node]);
  const [focused, setFocused] = useState(false);
  const [pillWidth, setPillWidth] = useState(0);
  const sunken = materialStyle(theme, "sunken");
  const pill = materialStyle(theme, "control");
  const config = sizeConfig(theme)[size];
  const face = theme.type.scale[config.face];

  const baseAccessibilityLabel = currencyInTranslation
    ? t(`${label} (${currency})`)
    : `${t(label)} (${currency})`;
  const accessibilityLabel = required
    ? `${baseAccessibilityLabel}, ${t("required")}`
    : baseAccessibilityLabel;
  const isInvalid = Boolean(error);
  const validityProps = {
    accessibilityState: { invalid: isInvalid },
    ...(process.env.EXPO_OS === "web" ? { "aria-invalid": isInvalid } : null),
  } as TextInputProps;

  const currencyPill = (
    <View
      onLayout={(event) => setPillWidth(event.nativeEvent.layout.width)}
      style={{
        flexShrink: 0,
        borderRadius: radius.pill,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        backgroundColor: pill.backgroundColor,
        boxShadow: pill.boxShadow as string,
      }}
    >
      <AppText literal variant="label" style={{ fontWeight: "700" }}>
        {currency}
      </AppText>
    </View>
  );

  return (
    <View style={{ gap: space.sm }}>
      {config.showLabel ? (
        <AppText
          variant="label"
          style={size === "display" ? { textAlign: "center" } : undefined}
        >
          {label}
        </AppText>
      ) : null}
      <View
        style={{
          borderRadius: config.radius,
          borderCurve: "continuous",
          paddingVertical: config.paddingVertical,
          paddingHorizontal: config.paddingHorizontal,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: sunken.backgroundColor,
          boxShadow: sunken.boxShadow as string,
          borderWidth: 2,
          borderColor: error
            ? theme.negative
            : focused
              ? theme.accent
              : "transparent",
        }}
      >
        <View
          style={{
            alignSelf: "stretch",
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: pillWidth, opacity: 0, flexShrink: 0 }}
          />
          <TextInput
            ref={setNode}
            value={input.value}
            onChangeText={input.onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.textMuted}
            {...input.inputProps}
            autoFocus={autoFocus}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={hint !== undefined ? t(hint) : undefined}
            aria-required={required || undefined}
            {...validityProps}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            onFocus={(event) => {
              setFocused(true);
              input.onFocus(event);
            }}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
            }}
            style={withAppFont(
              [
                {
                  flex: 1,
                  minWidth: 0,
                  paddingVertical: space.xs,
                  textAlign: "center",
                  fontSize: face.fontSize,
                  lineHeight: face.lineHeight,
                  letterSpacing: face.letterSpacing,
                  color: theme.text,
                  writingDirection: isRtl ? "rtl" : "ltr",
                },
              ],
              "semibold",
              "numeric",
              theme.type,
            )}
          />
          {onCurrencyPress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={currency}
              onPress={onCurrencyPress}
            >
              {currencyPill}
            </Pressable>
          ) : (
            currencyPill
          )}
        </View>
      </View>
      {hint !== undefined ? (
        <MotionView key={error ?? hint} variant="up" exit animateLayout>
          <AppText
            accessibilityRole={error ? "alert" : undefined}
            accessibilityLiveRegion={error ? "polite" : undefined}
            selectable
            variant="caption"
            muted={!error}
            style={error ? { color: theme.negative } : undefined}
          >
            {error ? t(error) : t(hint)}
          </AppText>
        </MotionView>
      ) : error ? (
        <MotionView key={error} variant="up" exit animateLayout>
          <AppText
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            selectable
            literal
            variant="caption"
            style={{ color: theme.negative, textAlign: "center" }}
          >
            {t(error)}
          </AppText>
        </MotionView>
      ) : null}
    </View>
  );
}
