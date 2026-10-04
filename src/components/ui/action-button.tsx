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
import { insetHighlight } from "@/theme/highlight";
import { withAlpha } from "@/theme/tokens";

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
    boxShadow: `${insetHighlight(theme.mode, 0.25)}, 0 1px 2px rgba(0,0,0,0.12), 0 6px 14px -4px rgba(0,0,0,0.22)`,
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
  // Material 3: flat filled buttons (primary, error) and a filled-tonal secondary, no shadows. A
  // disabled one is a 12% wash of the text color with 38% content, not a dimmed copy of itself.
  const m3 = theme.materialControls;
  const enabledForeground =
    variant === "primary"
      ? theme.onAccent
      : variant === "danger"
        ? theme.onNegative
        : m3
          ? theme.onSecondaryContainer
          : theme.text;
  const foreground =
    m3 && isDisabled ? withAlpha(theme.staticText, 0.38) : enabledForeground;
  // The visible button is 40px; the hit slop brings the target to the 48px the other themes use.
  const minHeight = size === "large" ? 56 : m3 ? 40 : 48;
  const textVariant = size === "large" ? "headline" : "label";
  const materialFor = (pressed: boolean): ViewStyle => {
    if (m3) {
      if (isDisabled)
        return { backgroundColor: withAlpha(theme.staticText, 0.12) };
      return {
        backgroundColor:
          variant === "primary"
            ? theme.accent
            : variant === "danger"
              ? theme.negative
              : theme.secondaryContainer,
      };
    }
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
      hitSlop={m3 && size !== "large" ? { top: 4, bottom: 4 } : undefined}
      stateLayerColor={enabledForeground}
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
          paddingHorizontal: m3 ? space.xxl : space.lg + 2,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space.sm,
          opacity: isDisabled && !m3 ? 0.45 : 1,
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
