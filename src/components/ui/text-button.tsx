import { type ColorValue, type PressableProps } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { MotionPressable } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";

export function TextButton({
  title,
  icon,
  tone = "accent",
  color: colorOverride,
  onPress,
  disabled = false,
  style,
  accessibilityState,
  ...props
}: Omit<PressableProps, "children"> & {
  title: string;
  icon?: string;
  tone?: "accent" | "muted" | "danger";
  /** A specific content color, for a button sitting on a non-standard surface (a snackbar). */
  color?: ColorValue;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const isDisabled = Boolean(disabled);
  const m3 = theme.materialControls;
  const color =
    colorOverride ??
    (tone === "danger"
      ? theme.negative
      : tone === "muted"
        ? theme.textMuted
        : theme.accentText);
  return (
    <MotionPressable
      accessibilityLabel={t(title)}
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, disabled: isDisabled }}
      {...props}
      disabled={isDisabled}
      onPress={onPress}
      stateLayerColor={color}
      style={(state) => [
        {
          minWidth: 44,
          minHeight: 44,
          paddingHorizontal: m3 ? space.md : space.sm - 2,
          // A Material text button is a full pill, so its hover wash is one too.
          borderRadius: m3 ? radius.pill : radius.control,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space.sm - 2,
          opacity: isDisabled
            ? m3
              ? 0.38
              : 0.4
            : state.pressed && !m3
              ? 0.6
              : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
    >
      {icon ? <AppIcon name={icon} color={color} size={16} /> : null}
      <AppText selectable={false} variant="label" style={{ color }}>
        {title}
      </AppText>
    </MotionPressable>
  );
}
