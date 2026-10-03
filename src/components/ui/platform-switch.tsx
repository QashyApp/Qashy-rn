import { Switch, type SwitchProps } from "react-native";

import { useQashyTheme } from "@/theme/theme";

/**
 * The platform's own switch, for themes that are not Material 3. React Native Web paints an
 * unset `false` track color as transparent, which made an "off" switch invisible against a
 * card. The off track uses the muted-text token (visible on both light and dark surfaces),
 * with a surface-colored knob; the on state uses the accent with an on-accent knob.
 */
export function PlatformSwitch({
  trackColor,
  thumbColor,
  ...props
}: SwitchProps) {
  const theme = useQashyTheme();
  return (
    <Switch
      {...props}
      trackColor={{ false: theme.textMuted, true: theme.accent, ...trackColor }}
      thumbColor={thumbColor ?? theme.surface}
      {...(process.env.EXPO_OS === "web"
        ? { activeThumbColor: theme.onAccent }
        : null)}
    />
  );
}
