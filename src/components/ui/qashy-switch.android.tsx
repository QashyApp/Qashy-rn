import { Host, Switch } from "@expo/ui/jetpack-compose";
import { semantics, testID } from "@expo/ui/jetpack-compose/modifiers";
import type { ColorValue, SwitchProps } from "react-native";

import { useOptimisticSwitch } from "@/components/ui/use-optimistic-switch";
import { hapticSelection } from "@/services/haptics";
import { useQashyTheme } from "@/theme/theme";

/**
 * The app's one toggle: the real Jetpack Compose Material 3 switch for every theme, so it has the
 * system's own animation, ripple and TalkBack behavior. Material You seeds Compose's palette
 * from the app accent (which follows the wallpaper when the accent source is the system), so the
 * track and thumb take the tonal M3 colors. Other themes pass their own tokens explicitly, so the
 * switch matches the theme's accent and, for High contrast, keeps its strong edges rather than
 * the softer tonal colors a seed would derive. A toggle shows at once and keeps showing until the
 * `value` prop follows (see `useOptimisticSwitch`).
 */
export function QashySwitch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  testID: testId,
}: SwitchProps) {
  const theme = useQashyTheme();
  const optimistic = useOptimisticSwitch(value ?? false, onValueChange);
  const accent: ColorValue = theme.accent;
  const modifiers = [
    ...(accessibilityLabel
      ? [semantics({ contentDescription: accessibilityLabel })]
      : []),
    ...(testId ? [testID(testId)] : []),
  ];
  return (
    <Host
      matchContents
      colorScheme={theme.mode}
      seedColor={typeof accent === "string" ? accent : undefined}
    >
      <Switch
        value={optimistic.value}
        enabled={!disabled}
        onCheckedChange={(next) => {
          hapticSelection();
          optimistic.onValueChange(next);
        }}
        colors={
          theme.materialControls
            ? undefined
            : {
                checkedTrackColor: theme.accent,
                checkedThumbColor: theme.onAccent,
                checkedBorderColor: theme.accent,
                uncheckedTrackColor: theme.surfaceSunken,
                uncheckedThumbColor: theme.textMuted,
                uncheckedBorderColor: theme.outline,
              }
        }
        modifiers={modifiers.length > 0 ? modifiers : undefined}
      />
    </Host>
  );
}
