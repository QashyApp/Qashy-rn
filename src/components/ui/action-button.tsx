import { type PressableProps, type ViewStyle } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { MotionPressable, MotionView } from "@/components/ui/motion";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import {
  hapticImpactLight,
  hapticSelection,
  hapticWarning,
} from "@/utils/haptics";

/**
 * The danger material isn't in `materials.ts` because it needs `theme.negative`
 * rather than `theme.accent` as its base color — the same "raised fill with an
 * inset top highlight and a soft drop shadow, pressed → inset only" shape as
 * `accent`/`accentPressed`, just built from the negative color family.
 */
function dangerMaterial(
  theme: ReturnType<typeof useQashyTheme>,
  pressed: boolean,
): ViewStyle {
  if (pressed)
    return {
      backgroundColor: theme.negative,
      boxShadow: theme.shadowControlPressed,
    };
  return {
    backgroundColor: theme.negative,
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.12), 0 6px 14px -4px rgba(0,0,0,0.22)",
  };
}

export function ActionButton({
  title,
  icon,
  variant = "primary",
  size = "regular",
  onPress,
  style,
  disabled = false,
  accessibilityState,
  busy = false,
  ...props
}: PressableProps & {
  title: string;
  icon?: string;
  variant?: "primary" | "secondary" | "danger";
  /** `large` is for a single hero action: taller and set in `headline` type. */
  size?: "regular" | "large";
  busy?: boolean;
}) {
  const theme = useQashyTheme();
  const { motion, radius, space } = theme;
  const isDisabled = Boolean(disabled);
  const foreground =
    variant === "primary"
      ? theme.onAccent
      : variant === "danger"
        ? theme.onNegative
        : theme.text;
  const minHeight = size === "large" ? 56 : 48;
  const textVariant = size === "large" ? "headline" : "label";
  const materialFor = (pressed: boolean): ViewStyle => {
    if (variant === "danger") return dangerMaterial(theme, pressed);
    if (variant === "primary")
      return materialStyle(theme, pressed ? "accentPressed" : "accent");
    return materialStyle(theme, pressed ? "controlPressed" : "control");
  };
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, busy, disabled: isDisabled }}
      {...props}
      disabled={isDisabled}
      pressedScale={motion.pressScale}
      onPress={(event) => {
        if (isDisabled) return;
        // A primary button is a direct, physical action (the FAB's own
        // haptic), a danger button is confirming something destructive (the
        // same cautionary buzz as any other destructive confirmation), and
        // everything else gets the lighter selection tick.
        if (variant === "primary") hapticImpactLight();
        else if (variant === "danger") hapticWarning();
        else hapticSelection();
        onPress?.(event);
      }}
      style={(pressableState) => [
        {
          minHeight,
          paddingHorizontal: space.lg + 2,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space.sm,
          opacity: isDisabled ? 0.45 : 1,
        },
        materialFor(pressableState.pressed),
        typeof style === "function" ? style(pressableState) : style,
      ]}
    >
      <MotionView
        key={`${title}-${icon ?? ""}`}
        variant="fade"
        animateLayout
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space.sm,
        }}
      >
        {icon ? <AppIcon name={icon} color={foreground} size={18} /> : null}
        <AppText
          selectable={false}
          variant={textVariant}
          style={{ color: foreground }}
        >
          {title}
        </AppText>
      </MotionView>
    </MotionPressable>
  );
}
