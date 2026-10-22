import type { SwitchProps } from "react-native";

import { MaterialSwitch } from "@/components/ui/material-switch";
import { PlatformSwitch } from "@/components/ui/platform-switch";
import { useOptimisticSwitch } from "@/components/ui/use-optimistic-switch";
import { useQashyTheme } from "@/theme/theme";

/**
 * The app's one toggle. Themes on the flat (Material 3) engine get a hand-drawn Material 3
 * switch here (the web has no native one); Android draws the real Compose switch, see
 * `qashy-switch.android.tsx`. Every other theme uses the platform switch. A toggle shows at once
 * and keeps showing until the `value` prop follows (see `useOptimisticSwitch`).
 */
export function QashySwitch({ value, onValueChange, ...props }: SwitchProps) {
  const theme = useQashyTheme();
  const optimistic = useOptimisticSwitch(value ?? false, onValueChange);
  const shared = { ...props, ...optimistic };
  return theme.materialControls ? (
    <MaterialSwitch {...shared} />
  ) : (
    <PlatformSwitch {...shared} />
  );
}
