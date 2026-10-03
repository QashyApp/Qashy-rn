import type { SwitchProps } from "react-native";

import { MaterialSwitch } from "@/components/ui/material-switch";
import { PlatformSwitch } from "@/components/ui/platform-switch";
import { useQashyTheme } from "@/theme/theme";

/**
 * The app's one toggle. Themes on the flat (Material 3) engine get a hand-drawn Material 3
 * switch here (web and iOS have no native one); Android draws the real Compose switch, see
 * `qashy-switch.android.tsx`. Every other theme uses the platform switch.
 */
export function QashySwitch(props: SwitchProps) {
  const theme = useQashyTheme();
  return theme.materialControls ? (
    <MaterialSwitch {...props} />
  ) : (
    <PlatformSwitch {...props} />
  );
}
