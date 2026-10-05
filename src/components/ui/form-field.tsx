import { useEffect, useState, type Ref } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useCalculatorHost } from "@/components/finance/calculator-host";
import { AppText } from "@/components/ui/app-text";
import { motionCurves, MotionView } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { withAppFont } from "@/theme/typography";

type FormFieldProps = TextInputProps & {
  /** Forwarded to the input, so a form can move focus field to field. */
  ref?: Ref<TextInput>;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /**
   * Set when the label is built from stored data — for example a per-category
   * cap field titled with the category the user named. Scoped to the label:
   * hints and validation errors are always developer copy and stay translated.
   */
  literalLabel?: boolean;
};

export function FormField(props: FormFieldProps) {
  const { materialControls } = useQashyTheme();
  return materialControls ? (
    <MaterialFormField {...props} />
  ) : (
    <ClassicFormField {...props} />
  );
}

/**
 * Material 3 filled text field: a container-highest well with a 4px top radius, the label resting
 * inside it and floating to the top when the field is focused or has a value, and a bottom
 * indicator that thickens and takes the accent on focus (or the error color).
 */
function MaterialFormField({
  label,
  hint,
  error,
  required = false,
  literalLabel = false,
  style,
  accessibilityHint,
  onFocus,
  onBlur,
  onChangeText,
  ...props
}: FormFieldProps) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { isRtl, t } = useLocalization();
  const calculatorHost = useCalculatorHost();
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState(String(props.defaultValue ?? ""));
  const hasValue = (props.value ?? typed).length > 0;
  const floated = focused || hasValue;
  const description = error ?? hint;
  const translatedLabel = literalLabel ? label : t(label);
  const translatedDescription = description ? t(description) : undefined;
  const baseAccessibilityLabel = props.accessibilityLabel
    ? t(props.accessibilityLabel)
    : translatedLabel;
  const fieldAccessibilityLabel = required
    ? `${baseAccessibilityLabel}, ${t("required")}`
    : baseAccessibilityLabel;
  const composedAccessibilityHint =
    [
      translatedDescription,
      accessibilityHint ? t(accessibilityHint) : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join(". ") || undefined;
  const isInvalid = Boolean(error);
  const validityProps = {
    accessibilityState: { ...props.accessibilityState, invalid: isInvalid },
    ...(process.env.EXPO_OS === "web" ? { "aria-invalid": isInvalid } : null),
  } as TextInputProps;

  const progress = useSharedValue(floated ? 1 : 0);
  useEffect(() => {
    progress.set(
      withTiming(floated ? 1 : 0, {
        duration: 150,
        easing: motionCurves.standard,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [floated, progress]);
  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -9 * progress.value },
      { scale: 1 - 0.25 * progress.value },
    ],
  }));

  const labelColor = error
    ? theme.negative
    : focused
      ? theme.accentText
      : theme.textMuted;
  const indicatorColor = error
    ? theme.negative
    : focused
      ? theme.accent
      : theme.textMuted;
  return (
    <View style={{ gap: space.xs }}>
      <View
        style={{
          minHeight: 56,
          borderTopStartRadius: 4,
          borderTopEndRadius: 4,
          overflow: "hidden",
          backgroundColor: theme.surfaceSunken,
        }}
      >
        <Animated.Text
          pointerEvents="none"
          selectable={false}
          style={[
            withAppFont(
              {
                position: "absolute",
                top: 17,
                start: space.lg,
                end: space.lg,
                fontSize: 16,
                color: labelColor,
                transformOrigin: isRtl ? "right top" : "left top",
                writingDirection: isRtl ? "rtl" : "ltr",
                textAlign: isRtl ? "right" : "left",
              },
              "regular",
              "text",
              theme.type,
            ),
            labelStyle,
          ]}
          numberOfLines={1}
        >
          {translatedLabel}
          {required ? " *" : ""}
        </Animated.Text>
        <TextInput
          {...props}
          placeholder={
            floated && props.placeholder ? t(props.placeholder) : undefined
          }
          accessibilityLabel={fieldAccessibilityLabel}
          accessibilityHint={composedAccessibilityHint}
          {...validityProps}
          aria-required={required || undefined}
          placeholderTextColor={theme.textMuted}
          onFocus={(event) => {
            setFocused(true);
            // Moving to a text field takes the calculator keypad away.
            if (props.inputMode !== "none") calculatorHost?.dismiss();
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onChangeText={(text) => {
            setTyped(text);
            onChangeText?.(text);
          }}
          style={withAppFont(
            [
              {
                minHeight: 56,
                paddingHorizontal: space.lg,
                paddingTop: 26,
                paddingBottom: 8,
                color: theme.text,
                fontSize: 16,
                writingDirection: isRtl ? "rtl" : "ltr",
                textAlign: isRtl ? "right" : "left",
              },
              style,
            ],
            "regular",
            "text",
            theme.type,
          )}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            start: 0,
            end: 0,
            bottom: 0,
            height: focused || error ? 2 : 1,
            backgroundColor: indicatorColor,
          }}
        />
      </View>
      {description ? (
        <MotionView key={description} variant="up" exit animateLayout>
          <AppText
            accessibilityRole={error ? "alert" : undefined}
            accessibilityLiveRegion={error ? "polite" : undefined}
            selectable
            literal
            variant="caption"
            muted={!error}
            style={{
              paddingHorizontal: space.lg,
              ...(error ? { color: theme.negative } : null),
            }}
          >
            {translatedDescription}
          </AppText>
        </MotionView>
      ) : null}
    </View>
  );
}

function ClassicFormField({
  label,
  hint,
  error,
  required = false,
  literalLabel = false,
  style,
  accessibilityHint,
  onFocus,
  onBlur,
  ...props
}: FormFieldProps) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { isRtl, t } = useLocalization();
  const calculatorHost = useCalculatorHost();
  const [focused, setFocused] = useState(false);
  const sunken = materialStyle(theme, "sunken");
  const description = error ?? hint;
  const translatedLabel = literalLabel ? label : t(label);
  const translatedDescription = description ? t(description) : undefined;
  const baseAccessibilityLabel = props.accessibilityLabel
    ? t(props.accessibilityLabel)
    : translatedLabel;
  const fieldAccessibilityLabel = required
    ? `${baseAccessibilityLabel}, ${t("required")}`
    : baseAccessibilityLabel;
  // The visible description (hint, or the error that replaces it) and the
  // caller's own hint are both meaningful, so announce both rather than
  // letting the description silently discard the caller's.
  const translatedCallerHint = accessibilityHint
    ? t(accessibilityHint)
    : undefined;
  const composedAccessibilityHint =
    [translatedDescription, translatedCallerHint]
      .filter((part): part is string => Boolean(part))
      .join(". ") || undefined;
  const isInvalid = Boolean(error);
  // React Native's AccessibilityState typing predates the `invalid` flag and
  // never modelled `aria-invalid`, but VoiceOver/TalkBack and the DOM both read
  // them at runtime. This assertion is the documented boundary for that gap.
  const validityProps = {
    accessibilityState: { ...props.accessibilityState, invalid: isInvalid },
    ...(process.env.EXPO_OS === "web" ? { "aria-invalid": isInvalid } : null),
  } as TextInputProps;
  return (
    <View style={{ gap: space.sm - 1 }}>
      <AppText literal={literalLabel} variant="label">
        {label}
        {required ? " *" : ""}
      </AppText>
      <TextInput
        {...props}
        placeholder={props.placeholder ? t(props.placeholder) : undefined}
        accessibilityLabel={fieldAccessibilityLabel}
        accessibilityHint={composedAccessibilityHint}
        {...validityProps}
        aria-required={required || undefined}
        placeholderTextColor={theme.textMuted}
        onFocus={(event) => {
          setFocused(true);
          // Moving to a text field takes the calculator keypad away.
          if (props.inputMode !== "none") calculatorHost?.dismiss();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={withAppFont(
          [
            {
              minHeight: 48,
              paddingHorizontal: space.lg - 2,
              paddingVertical: space.md,
              // Smaller than the card that holds it. Matching the container's own
              // 16 made the field read as a second card rather than a control.
              borderRadius: radius.tile,
              borderCurve: "continuous",
              // Always 2px, even at rest (transparent), so focusing or erroring
              // never shifts the content inside by changing the border width.
              borderWidth: 2,
              // Sunken at rest, like a track or a switch's own well; the border
              // only appears to carry an error, or a focus ring, so either one
              // means something when it shows up.
              borderColor: error
                ? theme.negative
                : focused
                  ? theme.accent
                  : "transparent",
              color: theme.text,
              fontSize: 16,
              writingDirection: isRtl ? "rtl" : "ltr",
              textAlign: isRtl ? "right" : "left",
              // A sunken well, same material as a progress track or a
              // segmented-control track.
              backgroundColor: sunken.backgroundColor,
              boxShadow: sunken.boxShadow as string,
            },
            style,
          ],
          "regular",
          "text",
          theme.type,
        )}
      />
      {description ? (
        <MotionView key={description} variant="up" exit animateLayout>
          <AppText
            accessibilityRole={error ? "alert" : undefined}
            accessibilityLiveRegion={error ? "polite" : undefined}
            selectable
            // Already resolved above; AppText must not translate it again.
            literal
            variant="caption"
            muted={!error}
            style={error ? { color: theme.negative } : undefined}
          >
            {translatedDescription}
          </AppText>
        </MotionView>
      ) : null}
    </View>
  );
}
