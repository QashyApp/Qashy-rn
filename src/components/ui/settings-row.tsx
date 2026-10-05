import { View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { IconBadge } from "@/components/ui/icon-badge";
import { MotionPressable } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";

export function SettingsRow({
  title,
  subtitle,
  icon,
  color,
  value,
  tone = "default",
  disabled = false,
  literal = false,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: string;
  color?: string;
  value?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  /**
   * Set when the row describes a stored entity (account, category, schedule,
   * rate) rather than fixed UI copy. Title, subtitle, and value are then
   * rendered and announced verbatim. Translate any fixed fragment at the call
   * site before composing it in.
   */
  literal?: boolean;
  /** When defined the row is in a multi-select list: a check marker replaces the chevron. */
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const destructive = tone === "danger";
  // Without this the row exposes title, subtitle, and value as three unrelated
  // leaves, so a screen reader never ties the value to what it belongs to.
  const accessibilityLabel = [title, subtitle, value]
    .filter((part): part is string => Boolean(part))
    .map((part) => (literal ? part : t(part)))
    .join(", ");
  // Same reasoning as the transaction row: an entity's color identifies it, it
  // does not rank it. A full-saturation tile in a list of thirty settings rows
  // reads as thirty alerts, so the seed is tinted toward the surface and the
  // glyph carries the contrast.
  const fallback = destructive
    ? { container: theme.surfaceMuted, onContainer: theme.negative }
    : { container: theme.accentContainer, onContainer: theme.accent };
  const fallbackFilled = destructive
    ? { container: theme.negative, onContainer: theme.onNegative }
    : { container: theme.accent, onContainer: theme.onAccent };
  return (
    <MotionPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={
        onPress
          ? selected === undefined
            ? { disabled }
            : { disabled, selected }
          : undefined
      }
      onPress={onPress}
      disabled={!onPress || disabled}
      pressedScale={0.985}
      style={({ pressed }) => ({
        minHeight: 58,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        opacity: disabled ? 0.5 : pressed && !theme.materialControls ? 0.62 : 1,
      })}
      stateLayer
    >
      <IconBadge
        icon={icon}
        color={color}
        role={color ? "category" : "ui"}
        fallback={fallback}
        fallbackFilled={fallbackFilled}
        raised
      />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1, gap: space.xxs }}
      >
        <AppText
          literal={literal}
          variant="label"
          style={destructive ? { color: theme.negative } : undefined}
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText literal={literal} variant="caption" muted numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          literal={literal}
          variant="caption"
          muted
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {value}
        </AppText>
      ) : null}
      {selected !== undefined ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            // M3 checkbox: an 18px square with a 2px radius.
            width: theme.materialControls ? 18 : 24,
            height: theme.materialControls ? 18 : 24,
            borderRadius: theme.materialControls ? 2 : 12,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: selected ? theme.accent : theme.textMuted,
            backgroundColor: selected ? theme.accent : "transparent",
          }}
        >
          {selected ? (
            <AppIcon
              name="checkmark"
              color={
                theme.materialControls ? theme.onAccent : theme.staticSurface
              }
              size={theme.materialControls ? 14 : 14}
            />
          ) : null}
        </View>
      ) : onPress ? (
        <AppIcon name="chevron.right" color={theme.textMuted} size={17} />
      ) : null}
    </MotionPressable>
  );
}
