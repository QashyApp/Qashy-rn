import { Host, Switch } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import type { ColorValue, SwitchProps } from "react-native";

import { PlatformSwitch } from "@/components/ui/platform-switch";
import { useQashyTheme } from "@/theme/theme";
import { hapticSelection } from "@/utils/haptics";

/**
 * The app's one toggle. On the flat (Material 3) engine this is the real Jetpack Compose
 * Material 3 switch, so it has the system's own animation, ripple and TalkBack behavior. The
 * `Host` seeds Compose's palette from the app accent (which already follows the wallpaper
 * when the accent source is the system), so the track and thumb take the tonal M3 colors.
 * Every other theme keeps the platform switch.
 */
export function QashySwitch(props: SwitchProps) {
  const theme = useQashyTheme();
  if (!theme.materialControls) return <PlatformSwitch {...props} />;
  return <ComposeSwitch {...props} />;
}

function ComposeSwitch({
  value = false,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: SwitchProps) {
  const theme = useQashyTheme();
  const accent: ColorValue = theme.accent;
  return (
    <Host
      matchContents
      colorScheme={theme.mode}
      seedColor={typeof accent === "string" ? accent : undefined}
    >
      <Switch
        value={value}
        enabled={!disabled}
        onCheckedChange={(next) => {
          hapticSelection();
          onValueChange?.(next);
        }}
        modifiers={
          accessibilityLabel
            ? [semantics({ contentDescription: accessibilityLabel })]
            : undefined
        }
      />
    </Host>
  );
}
