import { View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { MotionPressable } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { hapticSelection } from "@/services/haptics";

/**
 * A large selectable row for a radio group: a source app, or an import mode. Selected reads as
 * pushed in with the accent fill and a filled radio mark; the mark is drawn (icon plus fill),
 * never colour alone. Tapping a selected row does nothing, as a radio should.
 */
export function OptionRow({
  title,
  description,
  icon,
  selected,
  disabled = false,
  literal = false,
  onPress,
}: {
  title: string;
  description?: string;
  icon?: string;
  selected: boolean;
  disabled?: boolean;
  /**
   * Render title and description verbatim instead of translating them. For a language's own
   * name, which must read the same whatever the UI language is.
   */
  literal?: boolean;
  onPress: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const foreground = selected ? theme.onAccentContainer : theme.text;
  const say = (text: string) => (literal ? text : t(text));
  return (
    <MotionPressable
      accessibilityLabel={[title, description]
        .filter((part): part is string => Boolean(part))
        .map(say)
        .join(", ")}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      active={selected}
      disabled={disabled}
      onPress={() => {
        if (selected) return;
        hapticSelection();
        onPress();
      }}
      pressedScale={0.985}
      hoverScale={1.01}
      style={({ pressed }) => [
        {
          minHeight: description ? 64 : 56,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          padding: space.md + 2,
          borderRadius: radius.tile,
          borderCurve: "continuous",
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        selected
          ? materialStyle(theme, "selected")
          : materialStyle(theme, "control"),
      ]}
    >
      {icon ? (
        <AppIcon
          name={icon}
          color={selected ? theme.onAccentContainer : theme.textMuted}
          size={22}
        />
      ) : null}
      <View style={{ flex: 1, gap: space.xxs }}>
        <AppText
          literal={literal}
          variant="label"
          style={{ color: foreground }}
        >
          {title}
        </AppText>
        {description ? (
          <AppText
            literal={literal}
            variant="caption"
            muted={!selected}
            style={selected ? { color: theme.onAccentContainer } : undefined}
          >
            {description}
          </AppText>
        ) : null}
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: selected ? theme.onAccentContainer : theme.border,
          backgroundColor: selected ? theme.accent : "transparent",
        }}
      >
        {selected ? (
          <AppIcon name="checkmark" color={theme.onAccent} size={13} />
        ) : null}
      </View>
    </MotionPressable>
  );
}
